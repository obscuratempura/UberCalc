from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "orders.db"
MINUTES_BUFFER_MULTIPLIER = 1.15


app = FastAPI(title="Gig Order Decision Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CalculateRequest(BaseModel):
    pay: float = Field(gt=0)
    miles: float = Field(gt=0)
    minutes: float = Field(gt=0)
    target_hourly: float = Field(gt=0)
    min_per_mile: float = Field(gt=0)

    min_payout: float = Field(default=0, ge=0)
    max_minutes: float = Field(default=9999, gt=0)

    hourly_weight: float = Field(default=1.0)
    mile_weight: float = Field(default=1.0)
    time_penalty: float = Field(default=0.0)
    take_threshold: float | None = None
    slow_threshold: float | None = None
    time_buffer_multiplier: float = Field(default=MINUTES_BUFFER_MULTIPLIER, ge=1.0)
    advanced_mode: bool = False
    miles_per_gallon: float = Field(default=25.0, gt=0)
    gas_price_per_gallon: float = Field(default=3.5, ge=0)
    cost_per_mile: float = Field(default=0.30, ge=0)
    guaranteed_take_pay: float = Field(default=0.0, ge=0)


class CalculateResponse(BaseModel):
    hourly_rate: float
    dollars_per_mile: float
    score: float
    decision: Literal["TAKE", "ONLY_IF_SLOW", "DECLINE"]


class LogRequest(BaseModel):
    pay: float = Field(gt=0)
    miles: float = Field(gt=0)
    minutes: float = Field(gt=0)
    decision: Literal["TAKE", "ONLY_IF_SLOW", "DECLINE"]
    time: str | None = None


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pay REAL NOT NULL,
                miles REAL NOT NULL,
                minutes REAL NOT NULL,
                hourly_rate REAL NOT NULL,
                decision TEXT NOT NULL,
                logged_at TEXT NOT NULL
            )
            """
        )
        conn.commit()


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def adjusted_minutes(minutes: float, multiplier: float = MINUTES_BUFFER_MULTIPLIER) -> float:
    return minutes * multiplier


def calculate_metrics(payload: CalculateRequest) -> tuple[float, float, float]:
    effective_minutes = adjusted_minutes(payload.minutes, payload.time_buffer_multiplier)
    effective_pay = payload.pay
    if payload.advanced_mode:
        fuel_cost = (payload.miles / payload.miles_per_gallon) * payload.gas_price_per_gallon
        wear_cost = payload.miles * payload.cost_per_mile
        effective_pay = max(payload.pay - fuel_cost - wear_cost, 0)

    hourly_rate = (effective_pay / effective_minutes) * 60 if effective_minutes > 0 else 0
    dollars_per_mile = (effective_pay / payload.miles) if payload.miles > 0 else 0
    score = (
        (hourly_rate * payload.hourly_weight)
        + (dollars_per_mile * payload.mile_weight)
        - (effective_minutes * payload.time_penalty)
    )
    return hourly_rate, dollars_per_mile, score


def legacy_decision(payload: CalculateRequest, hourly_rate: float, dollars_per_mile: float) -> str:
    if payload.pay >= payload.guaranteed_take_pay and hourly_rate >= payload.target_hourly:
        return "TAKE"

    if hourly_rate >= payload.target_hourly and dollars_per_mile >= payload.min_per_mile:
        return "TAKE"
    if hourly_rate >= payload.target_hourly * 0.85:
        return "ONLY_IF_SLOW"
    return "DECLINE"


@app.post("/calculate", response_model=CalculateResponse)
def calculate(payload: CalculateRequest) -> CalculateResponse:
    hourly_rate, dollars_per_mile, score = calculate_metrics(payload)
    effective_minutes = adjusted_minutes(payload.minutes, payload.time_buffer_multiplier)

    if payload.pay < payload.min_payout or effective_minutes > payload.max_minutes:
        return CalculateResponse(
            hourly_rate=round(hourly_rate, 2),
            dollars_per_mile=round(dollars_per_mile, 2),
            score=round(score, 2),
            decision="DECLINE",
        )

    if payload.take_threshold is None or payload.slow_threshold is None:
        decision = legacy_decision(payload, hourly_rate, dollars_per_mile)
    else:
        if payload.pay >= payload.guaranteed_take_pay and hourly_rate >= payload.target_hourly:
            decision = "TAKE"
        else:
            take_threshold = max(payload.take_threshold, payload.slow_threshold)
            slow_threshold = min(payload.take_threshold, payload.slow_threshold)
            if score >= take_threshold:
                decision = "TAKE"
            elif score >= slow_threshold:
                decision = "ONLY_IF_SLOW"
            else:
                decision = "DECLINE"

    return CalculateResponse(
        hourly_rate=round(hourly_rate, 2),
        dollars_per_mile=round(dollars_per_mile, 2),
        score=round(score, 2),
        decision=decision,
    )


@app.post("/log")
def log_order(payload: LogRequest) -> dict[str, str | int]:
    logged_at = payload.time
    if logged_at is None:
        logged_at = datetime.now(timezone.utc).isoformat()

    try:
        parsed = datetime.fromisoformat(logged_at.replace("Z", "+00:00"))
        logged_at = parsed.isoformat()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid time format. Use ISO-8601.") from exc

    hourly_rate = (payload.pay / adjusted_minutes(payload.minutes)) * 60

    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO orders (pay, miles, minutes, hourly_rate, decision, logged_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                payload.pay,
                payload.miles,
                payload.minutes,
                hourly_rate,
                payload.decision,
                logged_at,
            ),
        )
        conn.commit()

    return {"status": "ok", "id": cursor.lastrowid}


@app.get("/stats")
def get_stats() -> dict:
    with get_connection() as conn:
        overall = conn.execute(
            """
            SELECT
                COALESCE(AVG(hourly_rate), 0) AS avg_hourly,
                COUNT(*) AS total_orders,
                SUM(CASE WHEN decision = 'TAKE' THEN 1 ELSE 0 END) AS accepted,
                SUM(CASE WHEN decision = 'DECLINE' THEN 1 ELSE 0 END) AS declined,
                SUM(CASE WHEN decision = 'ONLY_IF_SLOW' THEN 1 ELSE 0 END) AS only_if_slow
            FROM orders
            """
        ).fetchone()

        by_hour_rows = conn.execute(
            """
            SELECT
                strftime('%H', logged_at) AS hour,
                AVG(hourly_rate) AS avg_hourly,
                COUNT(*) AS orders
            FROM orders
            GROUP BY strftime('%H', logged_at)
            ORDER BY avg_hourly DESC
            """
        ).fetchall()

        by_day_rows = conn.execute(
            """
            SELECT
                strftime('%Y-%m-%d', logged_at) AS day,
                AVG(hourly_rate) AS avg_hourly,
                COUNT(*) AS orders
            FROM orders
            GROUP BY strftime('%Y-%m-%d', logged_at)
            ORDER BY day DESC
            """
        ).fetchall()

    by_hour = [
        {
            "hour": row["hour"],
            "avg_hourly": round(row["avg_hourly"], 2) if row["avg_hourly"] is not None else 0,
            "orders": row["orders"],
        }
        for row in by_hour_rows
    ]

    by_day = [
        {
            "day": row["day"],
            "avg_hourly": round(row["avg_hourly"], 2) if row["avg_hourly"] is not None else 0,
            "orders": row["orders"],
        }
        for row in by_day_rows
    ]

    best_hours = by_hour[:3]

    return {
        "overall": {
            "avg_hourly": round(overall["avg_hourly"], 2) if overall and overall["avg_hourly"] is not None else 0,
            "total_orders": overall["total_orders"] if overall else 0,
            "accepted": overall["accepted"] if overall and overall["accepted"] is not None else 0,
            "declined": overall["declined"] if overall and overall["declined"] is not None else 0,
            "only_if_slow": overall["only_if_slow"] if overall and overall["only_if_slow"] is not None else 0,
        },
        "best_hours": best_hours,
        "by_hour": by_hour,
        "by_day": by_day,
    }

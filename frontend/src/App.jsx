import { useEffect, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
const PAYPAL_DONATE_URL = "https://www.paypal.com/ncp/payment/P32RLRSVDSXZQ";
const PAY_LIMIT = 4;
const MILES_LIMIT = 3;
const MINUTES_LIMIT = 2;
const DEFAULT_BUFFER_PERCENT = 15;
const VOICE_SILENCE_TIMEOUT_MS = 4500;

const SMALL_NUMBERS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS_NUMBERS = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const MINUTE_UNIT_TOKENS = ["minute", "minutes", "min", "mins"];
const DISTANCE_UNIT_TOKENS = [
  "mile",
  "miles",
  "mi",
  "kilometer",
  "kilometers",
  "km",
  "kms",
  "ki",
  "kilo",
  "kilos",
];
const PAY_HINT_TOKENS = ["pay", "payout", "dollar", "dollars", "buck", "bucks"];

function toNumberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sanitizeDecimalInput(value, maxDigits) {
  const cleaned = value.replace(/[^\d.]/g, "");
  const hasDot = cleaned.includes(".");
  const rawParts = cleaned.split(".");
  const integerPartRaw = rawParts[0] || "";
  const decimalPartRaw = rawParts.slice(1).join("");

  const allDigits = (integerPartRaw + decimalPartRaw).slice(0, maxDigits);
  if (!hasDot) {
    return allDigits;
  }

  const integerLen = Math.min(integerPartRaw.length, allDigits.length);
  const integerDigits = allDigits.slice(0, integerLen);
  const decimalDigits = allDigits.slice(integerLen);

  if (!integerDigits) {
    return decimalDigits ? `0.${decimalDigits}` : "0.";
  }

  if (!decimalDigits && cleaned.endsWith(".")) {
    return `${integerDigits}.`;
  }

  return decimalDigits ? `${integerDigits}.${decimalDigits}` : integerDigits;
}

function sanitizeIntegerInput(value, maxDigits) {
  return value.replace(/\D/g, "").slice(0, maxDigits);
}

function countDigits(value) {
  return value.replace(/\D/g, "").length;
}

function normalizeSpeech(value) {
  return value
    .toLowerCase()
    .replace(/[$,]/g, " ")
    .replace(/[^\w./\s]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalSpeechSegment(value) {
  return normalizeSpeech(value).replace(/\s+/g, " ").trim();
}

function isNumberWord(token) {
  return token in SMALL_NUMBERS || token in TENS_NUMBERS || token === "hundred" || token === "thousand";
}

function isNumericToken(token) {
  return /^\d+(?:\.\d+)?$/.test(token) || isNumberWord(token);
}

function isSingleDigitToken(token) {
  if (/^\d$/.test(token)) {
    return true;
  }
  return token in SMALL_NUMBERS && SMALL_NUMBERS[token] <= 9;
}

function isTensToken(token) {
  return token in TENS_NUMBERS;
}

function sanitizeNumberTokens(tokens) {
  return tokens.filter((token) => isNumericToken(token) || token === "point");
}

function parseWordInteger(text) {
  const tokens = text
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);

  if (!tokens.length) {
    return NaN;
  }

  let total = 0;
  let current = 0;
  let foundAny = false;

  for (const token of tokens) {
    if (token in SMALL_NUMBERS) {
      current += SMALL_NUMBERS[token];
      foundAny = true;
      continue;
    }

    if (token in TENS_NUMBERS) {
      current += TENS_NUMBERS[token];
      foundAny = true;
      continue;
    }

    if (token === "hundred") {
      current = (current || 1) * 100;
      foundAny = true;
      continue;
    }

    if (token === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
      foundAny = true;
      continue;
    }

    if (
      ["and", "dollars", "dollar", "minutes", "minute", "mins", "miles", "mile", "km", "ki", "kilo", "kilometers"].includes(
        token
      )
    ) {
      continue;
    }

    return NaN;
  }

  if (!foundAny) {
    return NaN;
  }

  return total + current;
}

function parseFractionToken(token) {
  const match = token.match(/^(\d+)\/(\d+)$/);
  if (!match) {
    return NaN;
  }
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!denominator) {
    return NaN;
  }
  return numerator / denominator;
}

function parseFractionalExpression(cleaned) {
  const tokens = cleaned.split(" ").filter(Boolean);
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const leftNumber = Number(tokens[index]);
    const fraction = parseFractionToken(tokens[index + 1]);
    if (Number.isFinite(leftNumber) && Number.isFinite(fraction)) {
      return leftNumber + fraction;
    }
  }

  for (const token of tokens) {
    const fraction = parseFractionToken(token);
    if (Number.isFinite(fraction)) {
      return fraction;
    }
  }

  const reduced = tokens.filter((token) => !["and", "a", "an"].includes(token));
  const reducedText = reduced.join(" ");

  if (reducedText.endsWith("three quarters") || reducedText.endsWith("three quarter")) {
    const baseText = reducedText.replace(/three\s+quarters?$/, "").trim();
    const baseValue = baseText ? parseWordInteger(baseText) : 0;
    if (Number.isFinite(baseValue)) {
      return baseValue + 0.75;
    }
  }

  if (reducedText.endsWith("quarter") || reducedText.endsWith("quarters")) {
    const baseText = reducedText.replace(/quarters?$/, "").trim();
    const baseValue = baseText ? parseWordInteger(baseText) : 0;
    if (Number.isFinite(baseValue)) {
      return baseValue + 0.25;
    }
  }

  if (reducedText.endsWith("half") || reducedText.endsWith("halves")) {
    const baseText = reducedText.replace(/hal(f|ves)$/, "").trim();
    const baseValue = baseText ? parseWordInteger(baseText) : 0;
    if (Number.isFinite(baseValue)) {
      return baseValue + 0.5;
    }
  }

  return NaN;
}

function parseGeneralNumber(phrase) {
  const cleaned = normalizeSpeech(phrase);
  if (!cleaned) {
    return NaN;
  }

  const fractional = parseFractionalExpression(cleaned);
  if (Number.isFinite(fractional)) {
    return fractional;
  }

  const numericMatch = cleaned.match(/\d+(?:\.\d+)?/);
  if (numericMatch) {
    return Number(numericMatch[0]);
  }

  if (cleaned.includes("point")) {
    const [leftRaw, rightRaw] = cleaned.split("point");
    const left = parseWordInteger(leftRaw.trim());
    const rightTokens = rightRaw
      .trim()
      .split(" ")
      .filter(Boolean);

    const rightDigits = rightTokens
      .map((token) => {
        if (token in SMALL_NUMBERS && SMALL_NUMBERS[token] <= 9) {
          return String(SMALL_NUMBERS[token]);
        }
        if (/^\d$/.test(token)) {
          return token;
        }
        return "";
      })
      .join("");

    if (Number.isFinite(left) && rightDigits) {
      return Number(`${left}.${rightDigits}`);
    }
  }

  return parseWordInteger(cleaned);
}

function parsePay(phrase) {
  const cleaned = normalizeSpeech(phrase);
  if (!cleaned) {
    return NaN;
  }

  const payTokens = cleaned
    .split(" ")
    .filter(Boolean)
    .filter((token) => !["pay", "payout", "is", "for", "about", "around", "dollar", "dollars", "buck", "bucks", "cent", "cents"].includes(token));

  const payChunks = collectNumberChunks(payTokens);
  if (payChunks.length >= 1) {
    const parsedFirst = parseGeneralNumber(payChunks[0].text);
    if (Number.isFinite(parsedFirst)) {
      return Math.trunc(parsedFirst);
    }
  }

  const numericMatch = cleaned.match(/\d+(?:\.\d+)?/);
  if (numericMatch) {
    const numericValue = Number(numericMatch[0]);
    if (!Number.isFinite(numericValue)) {
      return NaN;
    }
    return Math.trunc(numericValue);
  }

  const tokens = cleaned.split(" ").filter(Boolean);
  if (!tokens.length) {
    return NaN;
  }

  const parsedInteger = parseWordInteger(cleaned);
  if (!Number.isFinite(parsedInteger)) {
    return NaN;
  }
  return Math.trunc(parsedInteger);
}

function hasCompleteVoiceUnits(transcript) {
  const normalized = normalizeSpeech(transcript);
  if (!normalized) {
    return false;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  const hasMinutesUnit = tokens.some((token) => MINUTE_UNIT_TOKENS.includes(token));
  const hasDistanceUnit = tokens.some((token) => DISTANCE_UNIT_TOKENS.includes(token));
  const hasPayUnit = tokens.some((token) => PAY_HINT_TOKENS.includes(token));
  return hasPayUnit && hasMinutesUnit && hasDistanceUnit;
}

function normalizeVoiceResult(result) {
  if (!result) {
    return null;
  }

  const pay = Math.trunc(toNumberOrZero(result.pay));
  const minutes = Math.round(toNumberOrZero(result.minutes));
  const miles = Math.round(toNumberOrZero(result.miles));

  if (!pay || !minutes || !miles) {
    return null;
  }

  return { pay, minutes, miles };
}

function extractAmountTokensBeforeUnit(tokens, unitIndex, mode) {
  const windowTokens = tokens.slice(Math.max(0, unitIndex - 8), unitIndex);
  const numberTokens = sanitizeNumberTokens(windowTokens);
  if (!numberTokens.length) {
    return [];
  }

  const last = numberTokens[numberTokens.length - 1];
  const prev = numberTokens[numberTokens.length - 2];
  const prev2 = numberTokens[numberTokens.length - 3];

  if (mode !== "pay" && mode !== "minutes" && prev2 && prev === "point" && isNumericToken(prev2) && isSingleDigitToken(last)) {
    return [prev2, prev, last];
  }

  if (prev && isTensToken(prev) && (last in SMALL_NUMBERS || /^\d$/.test(last))) {
    return [prev, last];
  }

  return [last];
}

function collectNumberChunks(tokens) {
  const chunks = [];
  let currentTokens = [];
  let chunkStart = -1;

  const flushChunk = (endIndex) => {
    if (!currentTokens.length) {
      return;
    }
    chunks.push({
      start: chunkStart,
      end: endIndex,
      text: currentTokens.join(" "),
    });
    currentTokens = [];
    chunkStart = -1;
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (isNumericToken(token) || token === "point") {
      if (chunkStart < 0) {
        chunkStart = index;
      }
      currentTokens.push(token);
    } else {
      flushChunk(index - 1);
    }
  }
  flushChunk(tokens.length - 1);

  return chunks;
}

function chooseChunkBeforeIndex(chunks, tokenIndex, usedChunkIndexes) {
  let chosen = null;
  for (let index = 0; index < chunks.length; index += 1) {
    if (usedChunkIndexes.has(index)) {
      continue;
    }
    const chunk = chunks[index];
    if (chunk.end < tokenIndex && (!chosen || chunk.end > chosen.chunk.end)) {
      chosen = { index, chunk };
    }
  }
  return chosen;
}

function chooseChunkNearKeyword(chunks, keywordIndex, usedChunkIndexes) {
  let chosen = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < chunks.length; index += 1) {
    if (usedChunkIndexes.has(index)) {
      continue;
    }
    const chunk = chunks[index];
    const chunkCenter = (chunk.start + chunk.end) / 2;
    const distance = Math.abs(chunkCenter - keywordIndex);
    if (distance < bestDistance) {
      bestDistance = distance;
      chosen = { index, chunk };
    }
  }

  return chosen;
}

function parseVoiceOrderFallbackFromChunks(chunks) {
  if (chunks.length < 3) {
    return null;
  }

  const pay = parsePay(chunks[0].text);
  const minutes = parseGeneralNumber(chunks[1].text);
  const miles = parseGeneralNumber(chunks[2].text);

  if (!Number.isFinite(pay) || !Number.isFinite(minutes) || !Number.isFinite(miles)) {
    return null;
  }

  if (pay <= 0 || minutes <= 0 || miles <= 0) {
    return null;
  }

  return { pay, minutes, miles };
}

function recoverMergedPayMinutesFromTranscript(normalized, pay, minutes, miles) {
  if (!Number.isFinite(pay) || pay <= 0 || !Number.isFinite(miles) || miles <= 0) {
    return { pay, minutes };
  }

  const dollars = Math.trunc(pay);
  const cents = Math.round((pay - dollars) * 100);
  if (cents <= 0 || cents >= 100) {
    return { pay, minutes };
  }

  const minutesMissingOrSuspicious = !Number.isFinite(minutes) || minutes <= 0 || minutes === dollars;
  if (!minutesMissingOrSuspicious) {
    return { pay, minutes };
  }

  const mergedPattern =
    /\b(\d+)\.(\d{1,2})\s+(\d{1,2})(?=\s+(?:and\s+)?\d+(?:\.\d+)?\s+(?:mile|miles|mi|kilometer|kilometers|km|kms|ki|kilo|kilos)\b)/;
  const match = normalized.match(mergedPattern);
  if (!match) {
    return { pay, minutes };
  }

  const matchedDollars = Number(match[1]);
  const matchedCents = Number(match[2]);
  const matchedMinutes = Number(match[3]);

  if (!Number.isFinite(matchedDollars) || !Number.isFinite(matchedCents) || !Number.isFinite(matchedMinutes)) {
    return { pay, minutes };
  }

  if (matchedDollars !== dollars || matchedCents !== matchedMinutes) {
    return { pay, minutes };
  }

  return {
    pay: matchedDollars,
    minutes: matchedMinutes,
  };
}

function parseVoiceOrder(transcript) {
  const normalized = normalizeSpeech(transcript);
  if (!normalized) {
    return null;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  const minutesUnitIndex = tokens.findIndex((token) => MINUTE_UNIT_TOKENS.includes(token));
  const distanceUnitIndex = tokens.findIndex((token) => DISTANCE_UNIT_TOKENS.includes(token));
  const dollarUnitIndex = tokens.findIndex((token) => ["dollar", "dollars", "buck", "bucks"].includes(token));
  const payKeywordIndex = tokens.findIndex((token) => ["pay", "payout"].includes(token));

  if (minutesUnitIndex < 0 || distanceUnitIndex < 0) {
    return null;
  }

  const minutesTokens = extractAmountTokensBeforeUnit(tokens, minutesUnitIndex, "minutes");
  const distanceTokens = extractAmountTokensBeforeUnit(tokens, distanceUnitIndex, "miles");
  const minutes = parseGeneralNumber(minutesTokens.join(" "));
  const miles = parseGeneralNumber(distanceTokens.join(" "));

  let pay = NaN;
  if (dollarUnitIndex >= 0) {
    const payTokens = extractAmountTokensBeforeUnit(tokens, dollarUnitIndex, "pay");
    pay = parsePay(payTokens.join(" "));
  }

  if (!Number.isFinite(pay) || pay <= 0) {
    const firstUnitIndex = Math.min(minutesUnitIndex, distanceUnitIndex);
    const payLeadTokens = sanitizeNumberTokens(tokens.slice(0, firstUnitIndex));
    if (payLeadTokens.length) {
      pay = parsePay(payLeadTokens.join(" "));
    }
  }

  if ((!Number.isFinite(pay) || pay <= 0) && payKeywordIndex >= 0) {
    const nextUnitAfterPay = [minutesUnitIndex, distanceUnitIndex]
      .filter((index) => index > payKeywordIndex)
      .sort((left, right) => left - right)[0];

    const paySearchEnd = Number.isFinite(nextUnitAfterPay) ? nextUnitAfterPay : tokens.length;
    const paySearchTokens = tokens.slice(payKeywordIndex + 1, paySearchEnd);
    const payChunks = collectNumberChunks(paySearchTokens);
    if (payChunks.length) {
      pay = parsePay(payChunks[0].text);
    }
  }

  if (!Number.isFinite(pay) || pay <= 0 || !Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(miles) || miles <= 0) {
    return null;
  }

  return normalizeVoiceResult({ pay, minutes, miles });
}

export default function App() {
  const [pay, setPay] = useState("");
  const [minutesDigits, setMinutesDigits] = useState("");
  const [miles, setMiles] = useState("");
  const [targetHourly, setTargetHourly] = useState("24");
  const [minPerMile, setMinPerMile] = useState("1.50");
  const [guaranteedTakePay, setGuaranteedTakePay] = useState("10");

  const [result, setResult] = useState(null);
  const [apiIssue, setApiIssue] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [heardText, setHeardText] = useState("");
  const [showPreferences, setShowPreferences] = useState(false);
  const [showDonate, setShowDonate] = useState(false);
  const [bufferPercent, setBufferPercent] = useState(String(DEFAULT_BUFFER_PERCENT));
  const [distanceUnit, setDistanceUnit] = useState("mi");
  const [advancedMode, setAdvancedMode] = useState(false);
  const [milesPerGallon, setMilesPerGallon] = useState("25");
  const [gasPricePerGallon, setGasPricePerGallon] = useState("3.50");
  const [costPerMile, setCostPerMile] = useState("0.30");

  const payInputRef = useRef(null);
  const minutesInputRef = useRef(null);
  const milesInputRef = useRef(null);
  const voiceTimerRef = useRef(null);
  const voiceTranscriptRef = useRef("");

  const minutes = minutesDigits;
  const parsedBufferPercent = Number(bufferPercent);
  const safeBufferPercent = Number.isFinite(parsedBufferPercent) ? Math.max(0, parsedBufferPercent) : DEFAULT_BUFFER_PERCENT;
  const activeBufferMultiplier = 1 + safeBufferPercent / 100;
  const parsedDistanceInput = toNumberOrZero(miles);
  const milesForCalculation = distanceUnit === "km" ? parsedDistanceInput * 0.621371 : parsedDistanceInput;
  const speechRecognitionSupported = typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => {
    payInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(async () => {
      const parsedPay = toNumberOrZero(pay);
      const parsedMinutes = toNumberOrZero(minutesDigits);
      const parsedMiles = milesForCalculation;

      if (!parsedPay || !parsedMinutes || !parsedMiles) {
        setApiIssue("");
        setResult(null);
        return;
      }

      try {
        const response = await fetch(`${API_BASE}/calculate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pay: parsedPay,
            minutes: parsedMinutes,
            miles: parsedMiles,
            target_hourly: toNumberOrZero(targetHourly),
            min_per_mile: toNumberOrZero(minPerMile),
            guaranteed_take_pay: toNumberOrZero(guaranteedTakePay),
            time_buffer_multiplier: activeBufferMultiplier,
            advanced_mode: advancedMode,
            miles_per_gallon: toNumberOrZero(milesPerGallon),
            gas_price_per_gallon: toNumberOrZero(gasPricePerGallon),
            cost_per_mile: toNumberOrZero(costPerMile),
          }),
        });

        if (!response.ok) {
          const responseBody = await response.text();
          const responsePreview = responseBody ? ` ${responseBody.slice(0, 120)}` : "";
          setApiIssue(`API ${response.status}.${responsePreview}`.trim());
          setResult(null);
          return;
        }

        const payload = await response.json();
        setApiIssue("");
        setResult(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to reach API";
        setApiIssue(`Cannot reach ${API_BASE} (${message})`);
        setResult(null);
      }
    }, 80);

    return () => window.clearTimeout(timeout);
  }, [
    pay,
    minutes,
    milesForCalculation,
    minutesDigits,
    targetHourly,
    minPerMile,
    guaranteedTakePay,
    activeBufferMultiplier,
    advancedMode,
    milesPerGallon,
    gasPricePerGallon,
    costPerMile,
  ]);

  function handleClear() {
    setPay("");
    setMinutesDigits("");
    setMiles("");
    setHeardText("");
    setResult(null);
  }

  function handleOpenDonate() {
    setShowDonate(true);
  }

  function handleDonateWithPaypal() {
    window.open(PAYPAL_DONATE_URL, "_blank", "noopener,noreferrer");
  }

  function onRowEnter(event, nextRef) {
    if (event.key === "Enter") {
      nextRef?.current?.focus();
    }
  }

  function handlePayChange(event) {
    const nextPay = sanitizeDecimalInput(event.target.value, PAY_LIMIT);
    setPay(nextPay);
    if (countDigits(nextPay) >= PAY_LIMIT && !nextPay.endsWith(".")) {
      window.setTimeout(() => minutesInputRef.current?.focus(), 0);
    }
  }

  function handleMinutesChange(event) {
    const nextMinutes = sanitizeIntegerInput(event.target.value, MINUTES_LIMIT);
    setMinutesDigits(nextMinutes);
    if (nextMinutes.length >= MINUTES_LIMIT) {
      window.setTimeout(() => milesInputRef.current?.focus(), 0);
    }
  }

  function handleMilesChange(event) {
    const nextMiles = sanitizeDecimalInput(event.target.value, MILES_LIMIT);
    setMiles(nextMiles);
  }

  function fillFieldsFromVoice(payValue, minutesValue, milesValue) {
    setPay(sanitizeDecimalInput(String(payValue), PAY_LIMIT));
    setMinutesDigits(sanitizeIntegerInput(String(Math.round(minutesValue)), MINUTES_LIMIT));
    setMiles(sanitizeDecimalInput(String(milesValue), MILES_LIMIT));
  }

  function clearVoiceTimer() {
    if (voiceTimerRef.current) {
      window.clearTimeout(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
  }

  function startVoiceSilenceTimer(recognition) {
    clearVoiceTimer();
    voiceTimerRef.current = window.setTimeout(() => {
      recognition.stop();
    }, VOICE_SILENCE_TIMEOUT_MS);
  }

  function handleVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition || isListening) {
      if (!SpeechRecognition) {
        setHeardText("Voice input not supported in this browser.");
      }
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    const finalSegments = [];

    function appendFinalSegment(segment) {
      const trimmedSegment = (segment || "").trim();
      if (!trimmedSegment) {
        return;
      }

      const nextCanonical = canonicalSpeechSegment(trimmedSegment);
      if (!nextCanonical) {
        return;
      }

      const lastSegment = finalSegments[finalSegments.length - 1];
      const lastCanonical = lastSegment ? canonicalSpeechSegment(lastSegment) : "";

      if (lastCanonical === nextCanonical) {
        return;
      }

      if (lastCanonical && nextCanonical.includes(lastCanonical)) {
        finalSegments[finalSegments.length - 1] = trimmedSegment;
        return;
      }

      if (lastCanonical && lastCanonical.includes(nextCanonical)) {
        return;
      }

      const hasExistingMatch = finalSegments.some((entry) => canonicalSpeechSegment(entry) === nextCanonical);
      if (hasExistingMatch) {
        return;
      }

      finalSegments.push(trimmedSegment);
    }

    setPay("");
    setMinutesDigits("");
    setMiles("");
    setResult(null);
    setIsListening(true);
    setHeardText("-");
    voiceTranscriptRef.current = "";

    recognition.onresult = (event) => {
      let interimTranscript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const chunk = (event.results[index][0].transcript || "").trim();
        if (event.results[index].isFinal) {
          appendFinalSegment(chunk);
        } else {
          interimTranscript = chunk;
        }
      }

      const combinedFinal = finalSegments.join(" ").trim();
      const currentTranscript = `${combinedFinal} ${interimTranscript}`.trim();
      if (currentTranscript) {
        voiceTranscriptRef.current = currentTranscript;
      }
      startVoiceSilenceTimer(recognition);
    };

    recognition.onspeechstart = () => {
      startVoiceSilenceTimer(recognition);
    };

    recognition.onerror = (event) => {
      clearVoiceTimer();
      if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
        setHeardText("Microphone blocked. Allow mic access for this site.");
        return;
      }
      if (event?.error === "no-speech") {
        setHeardText("No speech detected. Try again.");
        return;
      }
      if (event?.error) {
        setHeardText(`Voice error: ${event.error}`);
        return;
      }
      setHeardText("Voice input unavailable.");
    };

    recognition.onend = () => {
      clearVoiceTimer();
      setIsListening(false);

      const transcript = finalSegments.join(" ").trim() || (voiceTranscriptRef.current || "").trim();
      if (!transcript) {
        return;
      }

      setHeardText(transcript);
      const parsed = parseVoiceOrder(transcript);
      if (!parsed) {
        setHeardText("Could not parse order.");
        return;
      }

      setHeardText(`$${parsed.pay} ${parsed.minutes} minutes ${parsed.miles} miles`);

      fillFieldsFromVoice(parsed.pay, parsed.minutes, parsed.miles);
    };

    recognition.start();
  }

  function decisionClass(decision) {
    if (decision === "TAKE") {
      return "take";
    }
    if (decision === "ONLY_IF_SLOW") {
      return "slow";
    }
    return "decline";
  }

  function decisionLabel(decision) {
    if (decision === "TAKE") {
      return "TAKE IT";
    }
    if (decision === "ONLY_IF_SLOW") {
      return "ONLY IF SLOW";
    }
    if (decision === "DECLINE") {
      return "DECLINE";
    }
    return "WAITING";
  }

  function decisionPanelClass(decision) {
    if (decision === "TAKE") {
      return "take-bg";
    }
    if (decision === "ONLY_IF_SLOW") {
      return "slow-bg";
    }
    if (decision === "DECLINE") {
      return "decline-bg";
    }
    return "neutral-bg";
  }

  return (
    <main className="desktop">
      <section className="window" aria-label="Order Decision Calculator">
        <div className="title-bar">
          <span>Order Decision Calculator</span>
        </div>

        <div className="window-body">
          <div className="layout-split">
            <section className="left-panel">
              <button type="button" className="voice-button" onClick={handleVoiceInput} disabled={isListening}>
                {isListening ? "🎤 LISTENING..." : "🎤 VOICE ORDER"}
              </button>
              <div className="voice-heard">Heard: {heardText || "-"}</div>
              {!speechRecognitionSupported ? <div className="voice-heard">Voice input not supported in this browser.</div> : null}

              <div className="input-grid">
                <label htmlFor="pay">Pay:</label>
                <input
                  id="pay"
                  ref={payInputRef}
                  inputMode="decimal"
                  value={pay}
                  onChange={handlePayChange}
                  onKeyDown={(event) => onRowEnter(event, minutesInputRef)}
                  maxLength={5}
                  placeholder="00.00"
                />

                <label htmlFor="minutes">Minutes:</label>
                <input
                  id="minutes"
                  ref={minutesInputRef}
                  inputMode="numeric"
                  value={minutes}
                  onChange={handleMinutesChange}
                  onKeyDown={(event) => onRowEnter(event, milesInputRef)}
                  maxLength={MINUTES_LIMIT}
                  placeholder="00"
                />

                <label htmlFor="miles">{distanceUnit === "km" ? "Kilometers:" : "Miles:"}</label>
                <input
                  id="miles"
                  ref={milesInputRef}
                  inputMode="decimal"
                  value={miles}
                  onChange={handleMilesChange}
                  maxLength={4}
                  placeholder="0.0"
                />
              </div>

              <div className="button-bar">
                <button type="button" onClick={() => setShowPreferences(true)}>
                  PREFERENCES
                </button>
                <div className="button-group">
                  <button type="button" onClick={handleClear}>
                    CLEAR
                  </button>
                  <button type="button" onClick={handleOpenDonate} className="donate-desktop">
                    DONATE
                  </button>
                </div>
              </div>

              {advancedMode ? <div className="advanced-badge">★ Advanced Profit Mode ON</div> : null}
            </section>

            <section className={`result-zone ${decisionPanelClass(result?.decision)}`} aria-live="polite">
              <div className="rate-hero">${result?.hourly_rate?.toFixed?.(2) ?? "0.00"}/hr</div>
              <div className={`decision-hero ${decisionClass(result?.decision)}`}>{decisionLabel(result?.decision)}</div>
              {apiIssue ? <div className="api-issue">{apiIssue}</div> : null}
            </section>
          </div>

          <div className="voice-tip-bottom">
            Voice Tip: State your pay, minutes, then miles. Example: " 7 dollars, 15 minutes, 6 miles."
          </div>

          <div className="donate-row donate-mobile">
            <button type="button" onClick={handleOpenDonate} className="donate-launch">
              DONATE
            </button>
          </div>

          {showDonate ? (
            <div className="prefs-overlay" role="dialog" aria-modal="true" aria-label="Donate">
              <section className="prefs-window donate-window">
                <div className="prefs-title">Buy Me a Coffee</div>
                <div className="prefs-body donate-body">
                  <div>If you enjoy this app, buy me a coffee.</div>
                  <button type="button" onClick={handleDonateWithPaypal}>
                    PAYPAL
                  </button>
                  <div className="prefs-actions">
                    <button type="button" onClick={() => setShowDonate(false)}>
                      CLOSE
                    </button>
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          {showPreferences ? (
            <div className="prefs-overlay" role="dialog" aria-modal="true" aria-label="Preferences">
              <section className="prefs-window">
                <div className="prefs-title">Preferences</div>
                <div className="prefs-body">
                  <div className="prefs-grid">
                    <label htmlFor="pref-buffer">Extra Time %:</label>
                    <input
                      id="pref-buffer"
                      inputMode="numeric"
                      value={bufferPercent}
                      onChange={(event) => setBufferPercent(event.target.value.replace(/[^\d.]/g, ""))}
                    />

                    <label htmlFor="pref-unit">Distance Unit:</label>
                    <select
                      id="pref-unit"
                      value={distanceUnit}
                      onChange={(event) => setDistanceUnit(event.target.value)}
                    >
                      <option value="mi">Miles</option>
                      <option value="km">Kilometers</option>
                    </select>

                    <label htmlFor="pref-target-hour">Target $/Hour:</label>
                    <input
                      id="pref-target-hour"
                      inputMode="decimal"
                      value={targetHourly}
                      onChange={(event) => setTargetHourly(event.target.value.replace(/[^\d.]/g, ""))}
                    />

                    <label htmlFor="pref-target-mile">Min $/Mile:</label>
                    <input
                      id="pref-target-mile"
                      inputMode="decimal"
                      value={minPerMile}
                      onChange={(event) => setMinPerMile(event.target.value.replace(/[^\d.]/g, ""))}
                    />

                    <label htmlFor="pref-guaranteed-pay">Guaranteed Take Pay:</label>
                    <input
                      id="pref-guaranteed-pay"
                      inputMode="decimal"
                      value={guaranteedTakePay}
                      onChange={(event) => setGuaranteedTakePay(event.target.value.replace(/[^\d.]/g, ""))}
                    />

                    <label htmlFor="pref-advanced">Advanced Mode:</label>
                    <label className="pref-toggle">
                      <input
                        id="pref-advanced"
                        type="checkbox"
                        checked={advancedMode}
                        onChange={(event) => setAdvancedMode(event.target.checked)}
                      />
                      Enable
                    </label>

                    {advancedMode ? (
                      <>
                        <label htmlFor="pref-mpg">Miles per Gallon:</label>
                        <input
                          id="pref-mpg"
                          inputMode="decimal"
                          value={milesPerGallon}
                          onChange={(event) => setMilesPerGallon(event.target.value.replace(/[^\d.]/g, ""))}
                        />

                        <label htmlFor="pref-gas">Gas $/Gallon:</label>
                        <input
                          id="pref-gas"
                          inputMode="decimal"
                          value={gasPricePerGallon}
                          onChange={(event) => setGasPricePerGallon(event.target.value.replace(/[^\d.]/g, ""))}
                        />

                        <label htmlFor="pref-cpm">Cost per Mile:</label>
                        <input
                          id="pref-cpm"
                          inputMode="decimal"
                          value={costPerMile}
                          onChange={(event) => setCostPerMile(event.target.value.replace(/[^\d.]/g, ""))}
                        />
                      </>
                    ) : null}
                  </div>

                  <div className="prefs-actions">
                    <button type="button" onClick={() => setShowPreferences(false)}>
                      CLOSE
                    </button>
                  </div>
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

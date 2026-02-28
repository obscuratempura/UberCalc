# Copilot Instructions for UberCalc

## Project context
- This project is `UberCalc` with:
  - Frontend: `frontend/` (Vite + React)
  - Backend: `backend/` (FastAPI)
- Primary deployment target used by this project owner is **Render**.

## Working style
- Prefer direct, practical changes over long explanations.
- Keep UI changes minimal and preserve existing style.
- Do not remove existing features unless explicitly requested.

## Deployment workflow expectations
- Assume the owner expects changes to appear on deployed Render quickly.
- After code changes that affect behavior/UI:
  1. Run a targeted local validation (`npm run build` in `frontend` for frontend changes).
  2. Commit only the relevant files.
  3. Push to `main` so Render can deploy.
- If deployment does not reflect latest changes, verify whether local edits were pushed.

## Stack order feature expectations
- Keep regular and stack order flows separate.
- `stack` decisions are binary: TAKE or DECLINE.
- No guaranteed-pay threshold should gate stack decisions.

## Safety checks before finishing
- Confirm there are no obvious build errors in changed area.
- Confirm git status is clean or explain what remains uncommitted.

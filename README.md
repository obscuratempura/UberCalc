# UberCalc

Gig driving order decision app with FastAPI backend and React frontend.

## Local development

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Optional API base override:

```bash
set VITE_API_BASE=http://localhost:8000
```

Optional donation button link:

```bash
set VITE_DONATE_URL=https://cash.app/$YourTag
```

## Fastest share-link deployment (Vercel + Render)

This is the quickest way to get a public URL for testers.

### 1) Push repo to GitHub

From project root:

```bash
git init
git add .
git commit -m "Initial deploy-ready commit"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

### 2) Deploy backend on Render

1. Go to Render Dashboard → **New** → **Web Service**.
2. Connect your GitHub repo.
3. Configure:
	- **Root Directory**: `backend`
	- **Environment**: `Python`
	- **Build Command**: `pip install -r requirements.txt`
	- **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Click **Create Web Service**.
5. After deploy finishes, open:
	- `https://<your-render-service>.onrender.com/health`
6. Confirm it returns:
	- `{ "status": "ok" }`

Save your backend URL, for example:

```text
https://ubercalc-api.onrender.com
```

### 3) Deploy frontend on Vercel

1. Go to Vercel Dashboard → **Add New...** → **Project**.
2. Import the same GitHub repo.
3. Set project config:
	- **Framework Preset**: `Vite`
	- **Root Directory**: `frontend`
	- **Build Command**: `npm run build`
	- **Output Directory**: `dist`
4. Open **Environment Variables** and add:
	- `VITE_API_BASE` = `https://<your-render-service>.onrender.com`
5. Click **Deploy**.

### 4) Test and share

1. Open your Vercel URL.
2. Enter pay/minutes/miles and confirm result appears.
3. Share that Vercel URL with testers.

If you also want a Donate button in the app, add frontend env var:

- `VITE_DONATE_URL` = `https://cash.app/$YourTag`

## Super-fast fallback (frontend-only)

If backend deploy is slow and you need a link right now, you can deploy just the frontend first. The calculator result panel will require a live backend, but you can still share UI/flow for feedback while backend finishes deploying.

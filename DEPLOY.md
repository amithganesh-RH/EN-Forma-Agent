# Deployment Guide

## Overview
- **Web App** → Vercel (Next.js)
- **Agent Service** → Railway (Python + FastAPI + Playwright)

---

## Step 1 — Deploy Agent Service to Railway

1. Go to https://railway.app → New Project → Deploy from GitHub repo
   (or use `railway init` in the `agent/` folder)

2. Set these environment variables in Railway:
   ```
   EN_USERNAME=<your EN login>
   EN_PASSWORD=<your EN password>
   GOOGLE_CLIENT_ID=<from Google Cloud Console>
   GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
   GOOGLE_REFRESH_TOKEN=<from ~/.config/en_report/google_token.json>
   GDRIVE_FOLDER_ID=1L4qIfD4bha6oZpZTe7s5LbNcgRAgqLlL
   AGENT_WEBHOOK_SECRET=<generate: openssl rand -hex 20>
   DOWNLOAD_DIR=/app/employee_navigator_reports
   ```

3. Railway will auto-detect the Dockerfile and deploy.

4. Copy the public Railway URL (e.g. https://en-agent.up.railway.app)

5. Add a Railway Cron job:
   - Command: `curl -X POST http://localhost:8000/trigger -H "X-Webhook-Secret: 50c537c6e017fe88e634ee4135e8c8210403df9c"`
   - Schedule: `0 9 * * 1` (every Monday 9am — the script itself checks 1st/3rd)

---

## Step 2 — Deploy Web App to Vercel

1. Go to https://vercel.com → New Project → Import `en-reports-app/web`

2. Set these environment variables in Vercel:
   ```
   NEXTAUTH_SECRET=<generate: openssl rand -base64 32>
   NEXTAUTH_URL=https://your-app.dokploy.com
   GOOGLE_CLIENT_ID=<from Google Cloud Console>
   GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
   GOOGLE_REFRESH_TOKEN=<from ~/.config/en_report/google_token.json>
   GDRIVE_RAW_FOLDER_ID=1L4qIfD4bha6oZpZTe7s5LbNcgRAgqLlL
   GDRIVE_FORMA_FOLDER_ID=1tUzez4CpPUV9oks8XUY-HzBen54Q0AYs
   NEXT_PUBLIC_GDRIVE_RAW_FOLDER_ID=1L4qIfD4bha6oZpZTe7s5LbNcgRAgqLlL
   NEXT_PUBLIC_GDRIVE_FORMA_FOLDER_ID=1tUzez4CpPUV9oks8XUY-HzBen54Q0AYs
   AGENT_SERVICE_URL=https://your-agent.dokploy.com
   AGENT_WEBHOOK_SECRET=<same secret as agent>
   ```

3. Deploy. Once live, update NEXTAUTH_URL to the actual Vercel URL.

4. Add the Vercel URL as an authorized redirect URI in Google Cloud Console:
   - Go to https://console.cloud.google.com → APIs & Services → Credentials
   - Edit the OAuth client → Add: https://your-app.vercel.app/api/auth/callback/google

---

## Step 3 — Test locally first

```bash
# Terminal 1 — Agent service
cd ~/EN-Forma-Agent/agent
python3 -m venv .venv                       # first time only
.venv/bin/pip install -r requirements.txt   # ALL deps, not just fastapi+uvicorn
.venv/bin/playwright install chromium       # first time only
source ~/.zshrc                             # EN_USERNAME / EN_PASSWORD
.venv/bin/uvicorn main:app --port 8000

# Terminal 2 — Web app
cd ~/EN-Forma-Agent/web
npm install                                 # first time only
npm run dev
# Open http://localhost:3000  (the agent answers on :8000)
```

**Re-run `pip install -r requirements.txt` after pulling changes that add a
dependency.** An existing venv does not pick them up on its own, and the failure
surfaces late — only when the feature is first exercised. Installing just
`fastapi` and `uvicorn` is enough to boot the service and pass `/health`, but
SFTP push then fails with `No module named 'paramiko'`, and a report run dies
partway through without `openpyxl`.

---

## IAM — Who can access
Only @redesignhealth.com Google accounts can sign in.
To add/remove access: the domain restriction in `src/lib/auth.ts` controls this.
Individual email restriction can be added there if needed.

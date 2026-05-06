"""
EN Reports Agent Service
FastAPI service that runs the Employee Navigator report scripts on demand.
Deploy to Railway. Called by the Next.js web app's "Run Now" button.
"""

import os
import uuid
import asyncio
import subprocess
from datetime import datetime
from typing import Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException, Header, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google_auth import write_token_from_env

app = FastAPI(title="EN Reports Agent")

# Write Google credentials from env vars at startup
write_token_from_env()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

WEBHOOK_SECRET = os.environ.get("AGENT_WEBHOOK_SECRET", "")

# In-memory job store (Railway keeps the process alive)
jobs: dict[str, dict] = {}


def verify_secret(x_webhook_secret: str = Header(default="")):
    if WEBHOOK_SECRET and x_webhook_secret != WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="Invalid webhook secret")


class TriggerRequest(BaseModel):
    triggered_by: Optional[str] = "system"
    triggered_at: Optional[str] = None


def run_agent_sync(job_id: str):
    """Run the report script in a subprocess and track status."""
    jobs[job_id]["status"] = "running"
    jobs[job_id]["started_at"] = datetime.utcnow().isoformat()

    script_path = Path(__file__).parent / "en_weekly_report.py"
    env = {
        **os.environ,
        "PYTHONUNBUFFERED": "1",
    }

    try:
        result = subprocess.run(
            ["python3", str(script_path)],
            capture_output=True,
            text=True,
            timeout=600,  # 10 min max
            env=env,
        )
        jobs[job_id]["completed_at"] = datetime.utcnow().isoformat()
        jobs[job_id]["stdout"] = result.stdout[-4000:]  # last 4k chars
        jobs[job_id]["stderr"] = result.stderr[-2000:]

        if result.returncode == 0:
            jobs[job_id]["status"] = "completed"
        else:
            jobs[job_id]["status"] = "failed"
            jobs[job_id]["error"] = f"Exit code {result.returncode}. {result.stderr[-500:]}"
    except subprocess.TimeoutExpired:
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = "Agent timed out after 10 minutes"
        jobs[job_id]["completed_at"] = datetime.utcnow().isoformat()
    except Exception as e:
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = str(e)
        jobs[job_id]["completed_at"] = datetime.utcnow().isoformat()


@app.get("/health")
def health():
    return {"status": "ok", "service": "en-reports-agent"}


@app.post("/trigger")
async def trigger(
    body: TriggerRequest,
    background_tasks: BackgroundTasks,
    x_webhook_secret: str = Header(default=""),
):
    verify_secret(x_webhook_secret)

    # Prevent concurrent runs
    running = [j for j in jobs.values() if j["status"] == "running"]
    if running:
        return {
            "job_id": running[0]["job_id"],
            "status": "running",
            "message": "A run is already in progress",
        }

    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "triggered_by": body.triggered_by,
        "triggered_at": body.triggered_at or datetime.utcnow().isoformat(),
    }

    # Clean up old jobs (keep last 20)
    if len(jobs) > 20:
        old_keys = sorted(jobs.keys())[:-20]
        for k in old_keys:
            del jobs[k]

    background_tasks.add_task(run_agent_sync, job_id)
    return {"job_id": job_id, "status": "queued", "message": "Agent started"}


@app.get("/status")
def get_latest_status(x_webhook_secret: str = Header(default="")):
    verify_secret(x_webhook_secret)
    if not jobs:
        return {"status": "idle", "message": "No runs yet"}
    latest = sorted(jobs.values(), key=lambda j: j.get("triggered_at", ""))[-1]
    return latest


@app.get("/status/{job_id}")
def get_job_status(job_id: str, x_webhook_secret: str = Header(default="")):
    verify_secret(x_webhook_secret)
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id]


@app.get("/history")
def get_history(x_webhook_secret: str = Header(default="")):
    verify_secret(x_webhook_secret)
    return sorted(jobs.values(), key=lambda j: j.get("triggered_at", ""), reverse=True)

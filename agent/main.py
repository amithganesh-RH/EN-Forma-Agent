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
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env", override=False)

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
    allow_methods=["GET", "POST", "PUT"],
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


# ── SFTP ──────────────────────────────────────────────────────────────────────

@app.get("/sftp/status")
def sftp_status(x_webhook_secret: str = Header(default="")):
    """Return connection config and test reachability."""
    verify_secret(x_webhook_secret)
    host        = os.environ.get("SFTP_HOST", "")
    port        = int(os.environ.get("SFTP_PORT", "22"))
    username    = os.environ.get("SFTP_USERNAME", "")
    password    = os.environ.get("SFTP_PASSWORD", "")
    remote_path = os.environ.get("SFTP_REMOTE_PATH", "/")
    configured  = bool(host and username)
    result = {
        "host": host, "port": port, "username": username,
        "remote_path": remote_path, "configured": configured, "connected": False,
    }
    if configured:
        try:
            import paramiko
            t = paramiko.Transport((host, port))
            t.connect(username=username, password=password)
            t.close()
            result["connected"] = True
        except Exception as e:
            result["error"] = str(e)
    return result


@app.get("/sftp/browse")
def sftp_browse(path: str = "/", x_webhook_secret: str = Header(default="")):
    """List directory contents at the given remote path."""
    verify_secret(x_webhook_secret)
    host     = os.environ.get("SFTP_HOST", "")
    port     = int(os.environ.get("SFTP_PORT", "22"))
    username = os.environ.get("SFTP_USERNAME", "")
    password = os.environ.get("SFTP_PASSWORD", "")
    if not host or not username:
        raise HTTPException(status_code=503, detail="SFTP not configured")
    try:
        import paramiko, stat as _stat
        t = paramiko.Transport((host, port))
        t.connect(username=username, password=password)
        sftp = paramiko.SFTPClient.from_transport(t)
        items = []
        for attr in sftp.listdir_attr(path):
            is_dir = _stat.S_ISDIR(attr.st_mode or 0)
            items.append({
                "name": attr.filename,
                "type": "directory" if is_dir else "file",
                "size": attr.st_size or 0,
                "modified": attr.st_mtime or 0,
            })
        sftp.close()
        t.close()
        items.sort(key=lambda x: (0 if x["type"] == "directory" else 1, x["name"].lower()))
        return {"path": path, "items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SftpConfigRequest(BaseModel):
    host: str = ""
    port: int = 22
    username: str = ""
    password: str = ""
    remote_path: str = "/"


@app.put("/sftp/config")
def update_sftp_config(body: SftpConfigRequest, x_webhook_secret: str = Header(default="")):
    """Update SFTP settings in memory and persist to agent .env."""
    verify_secret(x_webhook_secret)
    mapping = {
        "SFTP_HOST": body.host,
        "SFTP_PORT": str(body.port),
        "SFTP_USERNAME": body.username,
        "SFTP_REMOTE_PATH": body.remote_path,
    }
    if body.password:
        mapping["SFTP_PASSWORD"] = body.password
    for k, v in mapping.items():
        os.environ[k] = v
    # Persist to .env
    env_path = Path(__file__).parent / ".env"
    lines = env_path.read_text().splitlines(keepends=True) if env_path.exists() else []
    updated: set = set()
    new_lines = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            new_lines.append(line)
            continue
        key = stripped.split("=", 1)[0].strip()
        if key in mapping:
            new_lines.append(f"{key}={mapping[key]}\n")
            updated.add(key)
        elif key == "SFTP_PASSWORD" and body.password:
            new_lines.append(f"SFTP_PASSWORD={body.password}\n")
            updated.add("SFTP_PASSWORD")
        else:
            new_lines.append(line)
    for k, v in mapping.items():
        if k not in updated:
            new_lines.append(f"{k}={v}\n")
    if body.password and "SFTP_PASSWORD" not in updated:
        new_lines.append(f"SFTP_PASSWORD={body.password}\n")
    env_path.write_text("".join(new_lines))
    return {"status": "updated"}


class SftpPushRequest(BaseModel):
    file_id: str
    file_name: str
    mime_type: str
    remote_dir: Optional[str] = None  # overrides SFTP_REMOTE_PATH if set


@app.post("/sftp/push")
def sftp_push(body: SftpPushRequest, x_webhook_secret: str = Header(default="")):
    """Download a file from Google Drive and push it to the configured SFTP server."""
    verify_secret(x_webhook_secret)

    host        = os.environ.get("SFTP_HOST", "")
    port        = int(os.environ.get("SFTP_PORT", "22"))
    username    = os.environ.get("SFTP_USERNAME", "")
    password    = os.environ.get("SFTP_PASSWORD", "")
    remote_path = body.remote_dir if body.remote_dir else os.environ.get("SFTP_REMOTE_PATH", "/")

    if not host or not username:
        raise HTTPException(
            status_code=503,
            detail="SFTP not configured. Set SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD, and SFTP_REMOTE_PATH.",
        )

    try:
        # ── Download from Google Drive ────────────────────────────────────
        import io
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaIoBaseDownload

        client_id     = os.environ.get("GOOGLE_CLIENT_ID", "")
        client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")
        refresh_token = os.environ.get("GDRIVE_DL_REFRESH_TOKEN", "")

        if client_id and client_secret and refresh_token:
            # Use the drive.readonly OAuth credentials (can see all Drive files)
            creds = Credentials(
                token=None,
                refresh_token=refresh_token,
                token_uri="https://oauth2.googleapis.com/token",
                client_id=client_id,
                client_secret=client_secret,
            )
            creds.refresh(Request())
        else:
            # Fallback to legacy token file
            token_path = os.environ.get(
                "GOOGLE_TOKEN_FILE",
                str(Path.home() / ".config/en_report/google_token.json"),
            )
            creds = Credentials.from_authorized_user_file(token_path)
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())

        drive = build("drive", "v3", credentials=creds)
        buf = io.BytesIO()

        # Google Sheets files must be exported as CSV; regular files downloaded directly
        if body.mime_type == "application/vnd.google-apps.spreadsheet":
            req = drive.files().export_media(fileId=body.file_id, mimeType="text/csv")
        else:
            req = drive.files().get_media(fileId=body.file_id)

        dl = MediaIoBaseDownload(buf, req)
        done = False
        while not done:
            _, done = dl.next_chunk()

        content = buf.getvalue()

        # ── Upload via SFTP ───────────────────────────────────────────────
        import paramiko

        transport = paramiko.Transport((host, port))
        transport.connect(username=username, password=password)
        sftp = paramiko.SFTPClient.from_transport(transport)

        # Always use .csv extension on the remote file
        remote_name = body.file_name if body.file_name.endswith(".csv") else body.file_name + ".csv"
        remote_file = f"{remote_path.rstrip('/')}/{remote_name}"

        with sftp.open(remote_file, "wb") as f:
            f.write(content)

        sftp.close()
        transport.close()

        return {"status": "success", "remote_path": remote_file, "bytes": len(content)}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

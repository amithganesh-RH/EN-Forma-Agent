"""
Builds Google credentials from environment variables for use in Railway.
Replaces the local file-based token approach.
"""
import os
import json
from pathlib import Path


def write_token_from_env():
    """
    Write google_token.json from env vars so the existing scripts work unchanged.
    - In Docker/cloud: GOOGLE_TOKEN_DIR points to a writable path (e.g. /tmp/en_report)
    - Locally: skips writing if the token file already exists at ~/.config/en_report
    """
    default_dir = str(Path.home() / ".config" / "en_report")
    token_dir = Path(os.environ.get("GOOGLE_TOKEN_DIR", default_dir))
    token_dir.mkdir(parents=True, exist_ok=True)
    token_file = token_dir / "google_token.json"
    creds_file = token_dir / "google_creds.json"

    # If token already exists locally (dev mode) and no refresh token in env, skip writing
    if token_file.exists() and not os.environ.get("GOOGLE_REFRESH_TOKEN"):
        os.environ["GOOGLE_CREDS_FILE"] = str(creds_file) if creds_file.exists() else str(token_file)
        os.environ.setdefault("GOOGLE_TOKEN_FILE", str(token_file))
        return str(token_file)

    # Write token
    token_data = {
        "token": os.environ.get("GOOGLE_ACCESS_TOKEN", ""),
        "refresh_token": os.environ.get("GOOGLE_REFRESH_TOKEN", ""),
        "token_uri": "https://oauth2.googleapis.com/token",
        "client_id": os.environ.get("GOOGLE_CLIENT_ID", ""),
        "client_secret": os.environ.get("GOOGLE_CLIENT_SECRET", ""),
        "scopes": [
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/spreadsheets.readonly",
        ],
    }
    token_file.write_text(json.dumps(token_data))

    # Write creds (needed for refresh flow)
    creds_data = {
        "installed": {
            "client_id": os.environ.get("GOOGLE_CLIENT_ID", ""),
            "client_secret": os.environ.get("GOOGLE_CLIENT_SECRET", ""),
            "redirect_uris": ["http://localhost"],
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    }
    creds_file.write_text(json.dumps(creds_data))

    # Set env vars that the scripts expect
    os.environ["GOOGLE_CREDS_FILE"] = str(creds_file)
    os.environ["GOOGLE_TOKEN_FILE"] = str(token_file)

    return str(token_file)

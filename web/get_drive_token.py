#!/usr/bin/env python3
"""
One-time script to get a Google OAuth refresh token with drive.readonly scope.

Run this once, then set the refresh token as GDRIVE_DL_REFRESH_TOKEN (NOT
GOOGLE_REFRESH_TOKEN — that one carries the drive.file write scope the agent
needs for uploads, and drive.readonly cannot upload).

GDRIVE_DL_REFRESH_TOKEN is what lets the web app list, and the agent download,
files that were uploaded into the Drive folders by hand.
"""
import json, os, sys, webbrowser
from pathlib import Path

# Read OAuth client credentials from environment — never hardcode secrets.
# Set these before running:  export GOOGLE_CLIENT_ID=...  GOOGLE_CLIENT_SECRET=...
CLIENT_ID     = os.environ.get("GOOGLE_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
SCOPES        = ["https://www.googleapis.com/auth/drive.readonly"]

TOKEN_OUT = Path(__file__).parent / "drive_readonly_token.json"

def main():
    from google_auth_oauthlib.flow import InstalledAppFlow

    if not CLIENT_ID or not CLIENT_SECRET:
        print("ERROR: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment "
              "variables before running this script.")
        sys.exit(1)

    client_config = {
        "installed": {
            "client_id":     CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "auth_uri":      "https://accounts.google.com/o/oauth2/auth",
            "token_uri":     "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }

    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
    creds = flow.run_local_server(port=0, prompt="consent", access_type="offline")

    token_data = json.loads(creds.to_json())
    refresh_token = token_data.get("refresh_token")

    if not refresh_token:
        print("ERROR: No refresh_token returned. Try revoking app access at "
              "https://myaccount.google.com/permissions and re-run.")
        return

    TOKEN_OUT.write_text(json.dumps(token_data, indent=2))
    print(f"\n✓ Token saved to: {TOKEN_OUT}")
    print("\nNext: set GDRIVE_DL_REFRESH_TOKEN in web/.env.local from the")
    print("'refresh_token' field of that file. Leave GOOGLE_REFRESH_TOKEN as is.")
    print("(The token is not printed here so it stays out of terminal scrollback.)")

if __name__ == "__main__":
    main()

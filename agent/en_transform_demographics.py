#!/usr/bin/env python3
"""
Transforms the raw Employee Navigator Demographics CSV into the
pretax demographics format and uploads it to a Google Drive subfolder.

Output filename: YYYYMMDD_pretax_demographics.csv
"""

import csv
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import List

GDRIVE_FOLDER_ID = os.environ.get("GDRIVE_FOLDER_ID", "1L4qIfD4bha6oZpZTe7s5LbNcgRAgqLlL")
GOOGLE_CREDS     = os.environ.get("GOOGLE_CREDS_FILE", str(Path.home() / ".config/en_report/google_creds.json"))
TOKEN_FILE       = str(Path(GOOGLE_CREDS).parent / "google_token.json")
SCOPES           = [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
]

OUTPUT_HEADERS = [
    "Employee ID",
    "Employee Email",
    "Country",
    "Legal Name - First Name",
    "Legal Name - Last Name",
    "Employee Status",
    "Date of Birth",
    "Employee Personal Email",
    "Preferred Name - First Name",
    "Preferred Name - Last Name",
    "Address Line 1",
    "Address Line 2",
    "City",
    "State",
    "ZIP Code",
    "Phone",
    "Hire Date",
    "Termination Date",
    "HDHP",
    "SSN",
]


def fix_zip(zip_code: str) -> str:
    """Pad 4-digit zip base with a leading 0 (e.g. '1234' → '01234', '1234-5678' → '01234-5678')."""
    z = zip_code.strip()
    if "-" in z:
        base, suffix = z.split("-", 1)
        if len(base) == 4 and base.isdigit():
            base = "0" + base
        return f"{base}-{suffix}"
    if len(z) == 4 and z.isdigit():
        z = "0" + z
    return z


def fix_employee_id(emp_id: str, first: str, last: str) -> str:
    """Ensure Brett Kempker's Employee ID always starts with '000'."""
    if first.strip().lower() == "brett" and last.strip().lower() == "kempker":
        if not emp_id.startswith("000"):
            emp_id = "000" + emp_id
    return emp_id


def transform(demographics_csv: Path) -> List[dict]:
    """Read demographics CSV, deduplicate by Employee ID, map to output format."""
    seen = set()
    rows = []

    with open(demographics_csv, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            emp_id = row.get("Employee ID", "").strip()
            if not emp_id or emp_id in seen:
                continue
            seen.add(emp_id)

            first = row.get("First Name", "").strip()
            last  = row.get("Last Name", "").strip()
            termination_date = row.get("Termination Date", "").strip()
            status = "Terminated" if termination_date else "Active"

            rows.append({
                "Employee ID":               fix_employee_id(emp_id, first, last),
                "Employee Email":            row.get("Work Email", "").strip(),
                "Country":                   row.get("Country", "").strip(),
                "Legal Name - First Name":   first,
                "Legal Name - Last Name":    last,
                "Employee Status":           status,
                "Date of Birth":             row.get("DOB", "").strip(),
                "Employee Personal Email":   row.get("Personal Email", "").strip(),
                "Preferred Name - First Name": first,
                "Preferred Name - Last Name":  last,
                "Address Line 1":            row.get("Address 1", "").strip(),
                "Address Line 2":            row.get("Address 2", "").strip(),
                "City":                      row.get("City", "").strip(),
                "State":                     row.get("State", "").strip(),
                "ZIP Code":                  fix_zip(row.get("Zip", "")),
                "Phone":                     row.get("Mobile Phone", "").strip(),
                "Hire Date":                 row.get("Hire Date", "").strip(),
                "Termination Date":          termination_date,
                "HDHP":                      "TRUE",
                "SSN":                       row.get("Social Security Number", "").strip(),
            })

    return rows


def get_drive_service():
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    creds = None
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(GOOGLE_CREDS, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, "w") as f:
            f.write(creds.to_json())
    return build("drive", "v3", credentials=creds)


def get_or_create_subfolder(service, parent_id: str, folder_name: str) -> str:
    """Return existing subfolder ID or create it."""
    query = (
        f"name='{folder_name}' and "
        f"'{parent_id}' in parents and "
        "mimeType='application/vnd.google-apps.folder' and "
        "trashed=false"
    )
    results = service.files().list(q=query, fields="files(id, name)").execute()
    files = results.get("files", [])
    if files:
        return files[0]["id"]

    metadata = {
        "name": folder_name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id],
    }
    folder = service.files().create(body=metadata, fields="id").execute()
    return folder["id"]


def upload_csv(service, file_path: Path, folder_id: str) -> str:
    from googleapiclient.http import MediaFileUpload
    media = MediaFileUpload(str(file_path), mimetype="text/csv", resumable=True)

    # Replace existing file with same name if it exists
    existing = service.files().list(
        q=f"name='{file_path.name}' and '{folder_id}' in parents and trashed=false",
        fields="files(id)"
    ).execute().get("files", [])

    if existing:
        uploaded = service.files().update(
            fileId=existing[0]["id"],
            media_body=media,
            fields="id, name, webViewLink"
        ).execute()
    else:
        file_metadata = {"name": file_path.name, "parents": [folder_id]}
        uploaded = service.files().create(
            body=file_metadata, media_body=media, fields="id, name, webViewLink"
        ).execute()
    return uploaded.get("webViewLink", "")


def run(demographics_csv: Path, output_dir: Path, date_str: str = None) -> str:
    """
    Transform demographics CSV and upload to Drive subfolder.
    Returns the Drive link.
    """
    if date_str is None:
        date_str = datetime.now().strftime("%Y%m%d")

    print(f"  [demographics] Transforming data...")
    rows = transform(demographics_csv)
    print(f"  [demographics] {len(rows)} unique employees found")

    # Write output CSV
    output_filename = f"{date_str}_pretax_demographics.csv"
    output_path = output_dir / output_filename
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_HEADERS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"  [demographics] Saved: {output_filename}")

    # Upload to Drive subfolder "Pretax Demographics"
    print(f"  [demographics] Uploading to Google Drive subfolder...")
    service = get_drive_service()
    subfolder_id = get_or_create_subfolder(service, GDRIVE_FOLDER_ID, "Demographics Upload File")
    link = upload_csv(service, output_path, subfolder_id)
    print(f"  [demographics] ✓ Uploaded: {output_filename}  →  {link}")
    return link


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        # Default to today's demographic file
        today = datetime.now().strftime("%Y-%m-%d")
        csv_path = Path.home() / "employee_navigator_reports" / f"demographic_{today}.csv"
    else:
        csv_path = Path(sys.argv[1])

    if not csv_path.exists():
        print(f"ERROR: File not found: {csv_path}")
        sys.exit(1)

    output_dir = Path.home() / "employee_navigator_reports"
    run(csv_path, output_dir, datetime.now().strftime("%Y%m%d"))

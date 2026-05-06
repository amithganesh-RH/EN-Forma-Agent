#!/usr/bin/env python3
"""
Transforms raw Employee Navigator HSA and FSA CSV reports into the
pretax elections upload format and uploads to Google Drive.

Output filename: YYYYMMDD_pretax_elections.csv

Column mapping:
  Employee ID, Employee Email, Plan Year, Account Type,
  Employee Pay Period Election, Employer Pay Period Election, Account Status,
  Account Start Date, Account End Date, Employee Election, Employer Election,
  Coverage Tier
"""

import csv
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional

GDRIVE_FOLDER_ID = os.environ.get("GDRIVE_FOLDER_ID", "1L4qIfD4bha6oZpZTe7s5LbNcgRAgqLlL")
GOOGLE_CREDS     = os.environ.get("GOOGLE_CREDS_FILE", str(Path.home() / ".config/en_report/google_creds.json"))
TOKEN_FILE       = str(Path(GOOGLE_CREDS).parent / "google_token.json")
SCOPES           = [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
]

PAYS_PER_YEAR    = 24          # semi-monthly pay schedule
PLAN_YEAR_START  = datetime(2026, 1, 1).date()
CUTOFF_DAYS      = 60          # exclude employees terminated more than this many days ago

OUTPUT_HEADERS = [
    "Employee ID",
    "Employee Email",
    "Plan Year",
    "Account Type",
    "Employee Pay Period Election",
    "Employer Pay Period Election",
    "Account Status",
    "Account Start Date",
    "Account End Date",
    "Employee Election",
    "Employer Election",
    "Coverage Tier",
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def parse_dollar(s: str) -> float:
    """Parse EN dollar strings like '$1,200.00' or '$0.00' into a float."""
    return float(s.strip().replace("$", "").replace(",", "") or 0)


def fmt_dollar(amount: float) -> str:
    """Format a float as '$1,234.56'."""
    return f"${amount:,.2f}"


def parse_date(s: str) -> Optional[datetime.date]:
    """Parse MM/DD/YYYY date strings from EN; return None if blank."""
    s = s.strip()
    if not s:
        return None
    return datetime.strptime(s, "%m/%d/%Y").date()


def fix_employee_id(emp_id: str, first: str, last: str) -> str:
    """Ensure Brett Kempker's Employee ID always starts with '000'."""
    if first.strip().lower() == "brett" and last.strip().lower() == "kempker":
        if not emp_id.startswith("000"):
            emp_id = "000" + emp_id
    return emp_id


def account_start_date(en_start: Optional[datetime.date]) -> str:
    """Return max(en_start, PLAN_YEAR_START) in YYYY-MM-DD format."""
    if en_start is None or en_start <= PLAN_YEAR_START:
        return PLAN_YEAR_START.strftime("%Y-%m-%d")
    return en_start.strftime("%Y-%m-%d")


# ── HSA transform ─────────────────────────────────────────────────────────────

def transform_hsa(hsa_csv: Path, today: datetime.date) -> List[dict]:
    """
    Read the HSA report and return election rows.

    Coverage Tier logic:
      Yearly Employer Contribution >= $1,500  →  Family  (standard $2,400 or prorated ~$2,000)
      Yearly Employer Contribution  < $1,500  →  Individual (standard $1,200 or prorated ~$1,000)

    Employer Pay Period Election:
      Family → $100.00  (fixed)
      Individual → $50.00 (fixed)

    Employer Pay Period for already-terminated employees (End Date <= today) → $0.00
    """
    cutoff = today - timedelta(days=CUTOFF_DAYS)
    rows = []

    with open(hsa_csv, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            emp_id    = row.get("Employee ID", "").strip()
            first     = row.get("First Name", "").strip()
            last      = row.get("Last Name", "").strip()
            email     = row.get("Work Email", "").strip()
            start_raw = row.get("Start Date", "").strip()
            end_raw   = row.get("End Date", "").strip()

            if not emp_id or not email:
                continue

            emp_id = fix_employee_id(emp_id, first, last)

            end_date   = parse_date(end_raw)
            start_date = parse_date(start_raw)

            # Skip employees terminated more than CUTOFF_DAYS ago
            if end_date and end_date < cutoff:
                continue

            yearly_employer = parse_dollar(row.get("Yearly Employer Contribution", "0"))
            ee_per_pay      = parse_dollar(row.get("Employee Per Pay", "0"))

            # Coverage Tier from annual employer contribution
            coverage_tier = "Family" if yearly_employer >= 1500 else "Individual"

            # Employer Pay Period: $0 if already terminated, else fixed Family/Individual rate
            if end_date and end_date <= today:
                er_per_pay_out = 0.0
            else:
                er_per_pay_out = 100.0 if coverage_tier == "Family" else 50.0

            status = "Terminated" if end_date else "Active"

            rows.append({
                "Employee ID":                 emp_id,
                "Employee Email":              email,
                "Plan Year":                   "",
                "Account Type":                "HSA",
                "Employee Pay Period Election": fmt_dollar(ee_per_pay),
                "Employer Pay Period Election": fmt_dollar(er_per_pay_out),
                "Account Status":              status,
                "Account Start Date":          account_start_date(start_date),
                "Account End Date":            "",
                "Employee Election":           fmt_dollar(ee_per_pay * PAYS_PER_YEAR),
                "Employer Election":           fmt_dollar(yearly_employer),
                "Coverage Tier":               coverage_tier,
            })

    return rows


# ── FSA / DCFSA transform ─────────────────────────────────────────────────────

def transform_fsa(fsa_csv: Path, today: datetime.date) -> List[dict]:
    """
    Read the FSA report and return FSA + DCFSA election rows.

    Rules:
    - Skip rows where EE Per Pay Cost = $0 (declined / not enrolled)
    - Skip rows where Employee ID is blank
    - For each (Employee ID, Account Type), keep only the most recent
      active enrollment: End Date blank OR End Date >= (today - CUTOFF_DAYS)
    - Account Type: "FSA" for Medical FSA, "DCFSA" for Dependent Care
    - Coverage Tier: FSA → "Individual", DCFSA → "Family"
    - Employer amounts always $0.00 for FSA/DCFSA
    - Account Status: "Active" if End Date blank, "Terminated" if End Date present
    - Employer Pay Period → $0 if already terminated (End Date <= today)
    """
    cutoff = today - timedelta(days=CUTOFF_DAYS)

    # Collect candidate rows: (employee_id, account_type) → list of rows
    from collections import defaultdict
    candidates = defaultdict(list)

    with open(fsa_csv, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            emp_id = row.get("Employee ID", "").strip()
            first  = row.get("First Name", "").strip()
            last   = row.get("Last Name", "").strip()
            email  = row.get("Work Email", "").strip()

            if not emp_id or not email:
                continue

            emp_id = fix_employee_id(emp_id, first, last)

            ee_per_pay = parse_dollar(row.get("EE Per Pay Cost", "0"))
            if ee_per_pay == 0:
                continue  # not enrolled / declined

            plan = row.get("Plan", "")
            if "Dependent Care" in plan:
                account_type  = "DCFSA"
                coverage_tier = "Family"
            else:
                account_type  = "FSA"
                coverage_tier = "Individual"

            start_raw = row.get("Start Date", "").strip()
            end_raw   = row.get("End Date", "").strip()
            end_date  = parse_date(end_raw)
            start_date = parse_date(start_raw)

            # Skip if ended too long ago
            if end_date and end_date < cutoff:
                continue

            candidates[(emp_id, account_type)].append({
                "emp_id":        emp_id,
                "email":         email,
                "account_type":  account_type,
                "coverage_tier": coverage_tier,
                "ee_per_pay":    ee_per_pay,
                "start_date":    start_date,
                "end_date":      end_date,
            })

    rows = []
    for (emp_id, account_type), cands in candidates.items():
        # Pick the enrollment with the latest Start Date
        best = max(cands, key=lambda c: c["start_date"] or PLAN_YEAR_START)

        end_date   = best["end_date"]
        start_date = best["start_date"]
        ee_per_pay = best["ee_per_pay"]
        coverage_tier = best["coverage_tier"]
        email      = best["email"]

        status = "Terminated" if end_date else "Active"

        # Employer is always $0 for FSA/DCFSA
        rows.append({
            "Employee ID":                 emp_id,
            "Employee Email":              email,
            "Plan Year":                   str(PLAN_YEAR_START.year),
            "Account Type":                account_type,
            "Employee Pay Period Election": fmt_dollar(ee_per_pay),
            "Employer Pay Period Election": "$0.00",
            "Account Status":              status,
            "Account Start Date":          account_start_date(start_date),
            "Account End Date":            "",
            "Employee Election":           fmt_dollar(ee_per_pay * PAYS_PER_YEAR),
            "Employer Election":           "$0.00",
            "Coverage Tier":               coverage_tier,
        })

    return rows


# ── Sort and deduplicate ───────────────────────────────────────────────────────

def sort_rows(rows: List[dict]) -> List[dict]:
    """Sort: HSA first, then DCFSA, then FSA; within each by Employee ID."""
    type_order = {"HSA": 0, "DCFSA": 1, "FSA": 2}
    return sorted(rows, key=lambda r: (
        type_order.get(r["Account Type"], 9),
        r["Employee ID"],
    ))


# ── Google Drive ──────────────────────────────────────────────────────────────

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
    file_metadata = {"name": file_path.name, "parents": [folder_id]}
    media = MediaFileUpload(str(file_path), mimetype="text/csv", resumable=True)
    uploaded = service.files().create(
        body=file_metadata, media_body=media, fields="id, name, webViewLink"
    ).execute()
    return uploaded.get("webViewLink", "")


# ── Public entry point ────────────────────────────────────────────────────────

def run(hsa_csv: Path, fsa_csv: Path, output_dir: Path, date_str: str = None) -> str:
    """
    Transform HSA + FSA CSVs into a combined elections upload CSV and upload to Drive.
    Returns the Google Drive link.
    """
    if date_str is None:
        date_str = datetime.now().strftime("%Y%m%d")

    today = datetime.now().date()

    print(f"  [elections] Processing HSA data...")
    hsa_rows = transform_hsa(hsa_csv, today)
    print(f"  [elections] {len(hsa_rows)} HSA rows")

    print(f"  [elections] Processing FSA/DCFSA data...")
    fsa_rows = transform_fsa(fsa_csv, today)
    print(f"  [elections] {len(fsa_rows)} FSA/DCFSA rows")

    all_rows = sort_rows(hsa_rows + fsa_rows)

    output_filename = f"{date_str}_pretax_elections.csv"
    output_path = output_dir / output_filename
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_HEADERS)
        writer.writeheader()
        writer.writerows(all_rows)
    print(f"  [elections] Saved: {output_filename} ({len(all_rows)} rows total)")

    print(f"  [elections] Uploading to Google Drive...")
    service = get_drive_service()
    subfolder_id = get_or_create_subfolder(service, GDRIVE_FOLDER_ID, "Elections Upload File")
    link = upload_csv(service, output_path, subfolder_id)
    print(f"  [elections] ✓ Uploaded: {output_filename}  →  {link}")
    return link


if __name__ == "__main__":
    import sys
    today_str = datetime.now().strftime("%Y-%m-%d")
    date_str  = datetime.now().strftime("%Y%m%d")

    if len(sys.argv) >= 3:
        hsa_path = Path(sys.argv[1])
        fsa_path = Path(sys.argv[2])
    else:
        reports_dir = Path.home() / "employee_navigator_reports"
        hsa_path = reports_dir / f"hsa_{today_str}.csv"
        fsa_path = reports_dir / f"fsa_{today_str}.csv"

    for p in (hsa_path, fsa_path):
        if not p.exists():
            print(f"ERROR: File not found: {p}")
            sys.exit(1)

    output_dir = Path.home() / "employee_navigator_reports"
    run(hsa_path, fsa_path, output_dir, date_str)

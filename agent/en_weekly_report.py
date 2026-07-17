#!/usr/bin/env python3
"""
Employee Navigator Weekly Report Downloader
Downloads Demographics, HSA, and FSA reports from Saved Report Templates,
with Employee ID included, and uploads them to Google Drive.

Required environment variables:
  EN_USERNAME       - Employee Navigator login username
  EN_PASSWORD       - Employee Navigator password
  EN_URL            - (Optional) Base URL, default: https://www.employeenavigator.com
  GOOGLE_CREDS_FILE - Path to Google OAuth2 credentials JSON
  GDRIVE_FOLDER_ID  - Google Drive folder ID to upload into
"""

import os
import sys
from datetime import datetime
from pathlib import Path

EN_URL           = os.environ.get("EN_URL", "https://www.employeenavigator.com").rstrip("/")
EN_USERNAME      = os.environ.get("EN_USERNAME", "")
EN_PASSWORD      = os.environ.get("EN_PASSWORD", "")
GOOGLE_CREDS     = os.environ.get("GOOGLE_CREDS_FILE", str(Path.home() / ".config/en_report/google_creds.json"))
TOKEN_FILE       = str(Path(GOOGLE_CREDS).parent / "google_token.json")
GDRIVE_FOLDER_ID = os.environ.get("GDRIVE_FOLDER_ID", "1L4qIfD4bha6oZpZTe7s5LbNcgRAgqLlL")
DOWNLOAD_DIR     = Path.home() / "employee_navigator_reports"
SCOPES           = [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
]

# Maps output filename prefix → partial text to match on the report template list
TARGET_REPORTS = {
    "demographic": "Demographic",
    "hsa":         "HSA",
    "fsa":         "FSA",
}


# ── Helpers ───────────────────────────────────────────────────────────────────
def screenshot(page, label):
    path = DOWNLOAD_DIR / f"debug_{label}_{datetime.now().strftime('%H%M%S')}.png"
    page.screenshot(path=str(path))
    return path


def try_click(page, selectors, timeout=5_000):
    """Try a list of CSS selectors in order; return True if one worked."""
    from playwright.sync_api import TimeoutError as PwTimeout
    for sel in selectors:
        try:
            page.click(sel, timeout=timeout)
            return True
        except PwTimeout:
            continue
    return False


# ── Login ─────────────────────────────────────────────────────────────────────
def login(page):
    print("  → Logging in...")
    # Retry navigation up to 3 times with 1-hour delay between attempts
    for attempt in range(1, 4):
        try:
            page.goto(f"{EN_URL}/Benefits/Account/Login", wait_until="networkidle", timeout=120_000)
            break
        except Exception as e:
            if attempt == 3:
                raise
            print(f"  ⚠ Navigation attempt {attempt} failed ({e}), retrying in 1 hour...")
            import time; time.sleep(3600)
    page.locator('input[type="text"], input:not([type="password"]):not([type="hidden"])').first.fill(EN_USERNAME)
    page.locator('input[type="password"]').first.fill(EN_PASSWORD)
    with page.expect_navigation(wait_until="networkidle", timeout=120_000):
        page.click('button:has-text("Login"), input[type="submit"], button[type="submit"]')
    if "login" in page.url.lower() or "Login" in page.title():
        raise RuntimeError("Login failed — check EN_USERNAME / EN_PASSWORD")
    print("  ✓ Logged in")


# ── Download one report ───────────────────────────────────────────────────────
def download_report(page, file_prefix: str, report_match: str, save_path: Path):
    from playwright.sync_api import TimeoutError as PwTimeout

    today = datetime.now().strftime("%Y-%m-%d")
    print(f"\n  [{file_prefix}] Navigating to Saved Report Templates...")

    # 1. Click "Home" to fully reset page state, then click "Reports" from the top nav.
    #    This is more reliable than navigating directly (no valid /Benefits/Reports URL)
    #    and avoids the issue where clicking "Reports" after an export lands on a
    #    report-specific sub-page instead of the Reports Menu.
    try:
        page.click('a:has-text("Home")', timeout=5_000)
        page.wait_for_load_state("networkidle")
    except PwTimeout:
        pass  # best effort — proceed even if Home click fails

    try:
        page.click('a:has-text("Reports")', timeout=8_000)
        page.wait_for_load_state("networkidle")
    except PwTimeout:
        shot = screenshot(page, f"{file_prefix}_no_reports_link")
        raise RuntimeError(f"Could not click 'Reports' nav link. See: {shot.name}")

    # 2. Click "Manage Saved Report Templates"
    try:
        page.click('a:has-text("Manage Saved Report Templates")', timeout=8_000)
        page.wait_for_load_state("networkidle")
    except PwTimeout:
        # Retry once: go Home → Reports again before giving up
        try:
            page.click('a:has-text("Home")', timeout=5_000)
            page.wait_for_load_state("networkidle")
            page.click('a:has-text("Reports")', timeout=8_000)
            page.wait_for_load_state("networkidle")
            page.click('a:has-text("Manage Saved Report Templates")', timeout=8_000)
            page.wait_for_load_state("networkidle")
        except PwTimeout:
            shot = screenshot(page, f"{file_prefix}_no_saved_link")
            raise RuntimeError(
                f"Could not find 'Manage Saved Report Templates' link. "
                f"See: {shot.name}"
            )

    print(f"  [{file_prefix}] On template list, clicking '{report_match}' report...")
    shot = screenshot(page, f"{file_prefix}_template_list")

    # 3. Click the report row by partial name match
    try:
        page.click(f'a:has-text("{report_match}")', timeout=6_000)
        page.wait_for_load_state("networkidle")
    except PwTimeout:
        shot = screenshot(page, f"{file_prefix}_not_found")
        raise RuntimeError(
            f"Could not find a report matching '{report_match}'. "
            f"See: {shot.name}"
        )

    shot = screenshot(page, f"{file_prefix}_report_config")
    print(f"  [{file_prefix}] On report config page (screenshot: {shot.name})")

    # 4. Ensure "Employee ID" is checked
    print(f"  [{file_prefix}] Checking 'Employee ID' option...")
    try:
        # Look for a checkbox near an "Employee ID" label
        emp_id_checkbox = page.locator(
            'input[type="checkbox"]',
            has=page.locator('text="Employee ID"')
        ).first
        if not emp_id_checkbox.is_checked():
            emp_id_checkbox.check()
            print(f"  [{file_prefix}] ✓ Checked 'Employee ID'")
        else:
            print(f"  [{file_prefix}] ✓ 'Employee ID' already checked")
    except Exception:
        # Fallback: find label with "Employee ID" text and check nearby checkbox
        try:
            page.locator('label:has-text("Employee ID")').first.click(timeout=4_000)
            print(f"  [{file_prefix}] ✓ Clicked 'Employee ID' label")
        except PwTimeout:
            print(f"  [{file_prefix}] ⚠ Could not find 'Employee ID' checkbox — continuing anyway")

    # 5. Click "View" to generate the report
    print(f"  [{file_prefix}] Clicking View...")
    try:
        page.click('button:has-text("View"), a:has-text("View"), input[value="View"]', timeout=6_000)
        page.wait_for_load_state("networkidle")
    except PwTimeout:
        shot = screenshot(page, f"{file_prefix}_no_view_btn")
        raise RuntimeError(f"Could not find 'View' button. See: {shot.name}")

    shot = screenshot(page, f"{file_prefix}_report_view")
    print(f"  [{file_prefix}] Report generated (screenshot: {shot.name})")

    # 6. Export as CSV
    # EN now shows a single "Download" button that directly triggers the download.
    # All click attempts must be inside expect_download so the download is captured.
    print(f"  [{file_prefix}] Exporting as CSV...")
    with page.expect_download(timeout=60_000) as dl_info:
        clicked = try_click(page, [
            'button:has-text("Download")',    # current EN UI — direct download
            'a:has-text("Download")',
            'a:has-text("Export to CSV")',    # legacy dropdown option
            'button:has-text("Export to CSV")',
            'li:has-text("CSV") a',
            'li:has-text("CSV")',
            'a:has-text("CSV")',
            'button:has-text("CSV")',
            'a:has-text("Export")',
            'button:has-text("Export")',
        ], timeout=8_000)

        if not clicked:
            shot = screenshot(page, f"{file_prefix}_no_export")
            raise RuntimeError(
                f"Could not find Export/CSV button. See: {shot.name}"
            )

    dl_info.value.save_as(str(save_path))
    print(f"  [{file_prefix}] ✓ Saved: {save_path.name}")
    return save_path


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
            if not os.path.exists(GOOGLE_CREDS):
                raise FileNotFoundError(f"Google credentials not found: {GOOGLE_CREDS}")
            flow = InstalledAppFlow.from_client_secrets_file(GOOGLE_CREDS, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, "w") as f:
            f.write(creds.to_json())
    return build("drive", "v3", credentials=creds)


def upload_to_drive(file_path: Path) -> str:
    from googleapiclient.http import MediaFileUpload
    service = get_drive_service()
    file_metadata = {"name": file_path.name, "parents": [GDRIVE_FOLDER_ID]}
    media = MediaFileUpload(str(file_path), mimetype="text/csv", resumable=True)
    uploaded = service.files().create(
        body=file_metadata, media_body=media, fields="id, name, webViewLink"
    ).execute()
    link = uploaded.get("webViewLink", "")
    print(f"  ✓ Uploaded: {uploaded['name']}  →  {link}")
    return link


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    if not EN_USERNAME or not EN_PASSWORD:
        print("ERROR: EN_USERNAME and EN_PASSWORD must be set.")
        sys.exit(1)

    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    Path(GOOGLE_CREDS).parent.mkdir(parents=True, exist_ok=True)

    today    = datetime.now().strftime("%Y-%m-%d")
    date_str = datetime.now().strftime("%Y%m%d")
    print(f"=== Employee Navigator Weekly Reports — {today} ===\n")

    from playwright.sync_api import sync_playwright

    downloaded = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()

        try:
            login(page)
        except Exception as e:
            print(f"FATAL: {e}")
            sys.exit(1)

        for file_prefix, report_match in TARGET_REPORTS.items():
            save_path = DOWNLOAD_DIR / f"{file_prefix}_{today}.csv"
            try:
                download_report(page, file_prefix, report_match, save_path)
                downloaded.append(save_path)
            except Exception as e:
                print(f"  ✗ FAILED [{file_prefix}]: {e}")

        browser.close()

    print(f"\n=== Uploading {len(downloaded)} report(s) to Google Drive ===")
    for f in downloaded:
        try:
            upload_to_drive(f)
        except Exception as e:
            print(f"  ✗ Upload failed for {f.name}: {e}")

    # ── Transform demographics → pretax format and upload to subfolder ──────
    demo_file = DOWNLOAD_DIR / f"demographic_{today}.csv"
    if demo_file.exists():
        print(f"\n=== Transforming Demographics → Pretax Format ===")
        try:
            scripts_dir = str(Path(__file__).resolve().parent)
            if scripts_dir not in sys.path:
                sys.path.insert(0, scripts_dir)
            import en_transform_demographics as transform_mod
            date_str = datetime.now().strftime("%Y%m%d")
            transform_mod.run(demo_file, DOWNLOAD_DIR, date_str)
        except Exception as e:
            print(f"  ✗ Demographics transform failed: {e}")
    else:
        print(f"\n⚠ Demographics file not found, skipping pretax transform.")

    # ── Transform HSA + FSA → pretax elections format and upload ────────────
    hsa_file = DOWNLOAD_DIR / f"hsa_{today}.csv"
    fsa_file = DOWNLOAD_DIR / f"fsa_{today}.csv"
    if hsa_file.exists() and fsa_file.exists():
        print(f"\n=== Transforming HSA + FSA → Elections Upload Format ===")
        try:
            import en_transform_elections as elections_mod
            elections_mod.run(hsa_file, fsa_file, DOWNLOAD_DIR, date_str)
        except Exception as e:
            print(f"  ✗ Elections transform failed: {e}")
    else:
        missing = [str(f) for f in (hsa_file, fsa_file) if not f.exists()]
        print(f"\n⚠ Missing files for elections transform: {', '.join(missing)}")

    # ── Transform elections → contributions format and upload ─────────────────
    elections_file = DOWNLOAD_DIR / f"{date_str}_pretax_elections.csv"
    if elections_file.exists():
        print(f"\n=== Transforming Elections → Contributions Upload Format ===")
        try:
            import en_transform_contributions as contributions_mod
            contributions_mod.run(elections_file, DOWNLOAD_DIR, date_str, datetime.now().date())
        except Exception as e:
            print(f"  ✗ Contributions transform failed: {e}")
    else:
        print(f"\n⚠ Elections file not found, skipping contributions transform.")

    print(f"\n=== Done — {len(downloaded)}/{len(TARGET_REPORTS)} reports completed ===")


if __name__ == "__main__":
    main()

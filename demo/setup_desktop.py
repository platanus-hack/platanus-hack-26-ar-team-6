#!/usr/bin/env python3
"""Write ~/.config/relevo/settings.json for a demo user (no OAuth needed).

Usage:
    python demo/setup_desktop.py leonardo
    python demo/setup_desktop.py donatello
    python demo/setup_desktop.py michelangelo
    python demo/setup_desktop.py raphael

The local server must be running before you call this script.
"""
import json
import pathlib
import sys
import urllib.error
import urllib.request

SERVER = "http://localhost:8000"

TOKENS: dict[str, str] = {
    "leonardo": "rlv_demo_leonardo_session_token",
    "donatello": "rlv_demo_donatello_session_token",
    "michelangelo": "rlv_demo_michelangelo_session_token",
    "raphael": "rlv_demo_raphael_session_token",
}

user_key = sys.argv[1].lower() if len(sys.argv) > 1 else "leonardo"
if user_key not in TOKENS:
    print(f"Unknown user '{user_key}'. Choose from: {', '.join(TOKENS)}", file=sys.stderr)
    sys.exit(1)

token = TOKENS[user_key]

req = urllib.request.Request(
    f"{SERVER}/me/projects",
    headers={"Authorization": f"Bearer {token}"},
)
try:
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
except urllib.error.URLError as exc:
    print(f"Could not reach {SERVER} — is the local server running?", file=sys.stderr)
    print(f"  {exc}", file=sys.stderr)
    sys.exit(1)

settings_path = pathlib.Path.home() / ".config" / "relevo" / "settings.json"
try:
    existing: dict = json.loads(settings_path.read_text())
except Exception:
    existing = {}

existing.update(
    {
        "relevoSessionToken": {"value": token, "encrypted": False},
        "account": data["account"],
        "projects": data["projects"],
        "selectedProjectId": None,
        "projectFolders": {},
    }
)
settings_path.parent.mkdir(parents=True, exist_ok=True)
settings_path.write_text(json.dumps(existing, indent=2) + "\n")

print(f"Desktop configured for: {user_key}")
print(f"  Token : {token}")
print(f"  Settings: {settings_path}")
print("Launch the desktop app — it should be logged in as", data["account"]["display_name"])

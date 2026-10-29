import json
import mimetypes
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

api_key = os.getenv("GNANI_API_KEY", "").strip()
if not api_key:
    sys.exit("Missing GNANI_API_KEY. Check your project-root .env file.")

if len(sys.argv) != 2:
    sys.exit("Provide the path to your test audio file.")

audio_path = Path(sys.argv[1]).resolve()
if not audio_path.is_file():
    sys.exit(f"Audio file not found: {audio_path}")

mime_type = mimetypes.guess_type(audio_path.name)[0]
mime_type = mime_type or "application/octet-stream"

print("Sending recording to Gnani Prisma V3.0...")

try:
    with audio_path.open("rb") as recording:
        response = requests.post(
            "https://api.vachana.ai/stt/v3",
            headers={"X-API-Key-ID": api_key},
            files={
                "audio_file": (audio_path.name, recording, mime_type)
            },
            data={
                "model": "prisma-v3.0",
                "language_code": "indic-auto",
            },
            timeout=60,
            allow_redirects=False,
        )
except requests.RequestException:
    sys.exit("Connection failed or timed out. Check your internet connection.")

print(f"HTTP status: {response.status_code}")

try:
    result = response.json()
    output = json.dumps(result, ensure_ascii=False, indent=2)
except ValueError:
    output = response.text[:2000]

# Prevent the key from appearing if a server response echoes it.
print(output.replace(api_key, "[REDACTED]"))

if not response.ok:
    sys.exit("Request failed. Share the status and redacted output for debugging.")
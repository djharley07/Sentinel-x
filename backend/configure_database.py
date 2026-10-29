from getpass import getpass
from pathlib import Path

from dotenv import set_key

ROOT = Path(__file__).resolve().parents[1]
env_file = ROOT / ".env"

if not env_file.is_file():
    raise SystemExit("Project-root .env file not found.")

password = getpass("Database password (hidden): ")
confirmation = getpass("Enter it again (hidden): ")

if not password or password != confirmation:
    raise SystemExit("Passwords are empty or do not match. Nothing changed.")

set_key(str(env_file), "DB_PASSWORD", password, quote_mode="always")
print("Database password saved to your local .env file.")
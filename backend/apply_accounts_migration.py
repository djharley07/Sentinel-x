"""Apply only migration 008 using the existing root .env database settings."""
from pathlib import Path
from app.database import get_connection

if __name__ == '__main__':
    path = Path(__file__).resolve().parents[1] / 'database/migrations/008_accounts.sql'
    try:
        with get_connection() as conn:
            conn.execute(path.read_text(encoding='utf-8'))
        print('Migration 008 applied. Existing reports and repair logs were preserved.')
    except Exception as error:
        print('Migration failed ('+type(error).__name__+'). Check your database connection and migrations 001–007. Keep the backend stopped until this succeeds.')
        raise SystemExit(1)

from pathlib import Path
from app.database import get_connection
if __name__=='__main__':
    try:
        with get_connection() as conn:
            conn.execute((Path(__file__).resolve().parents[1]/'database/migrations/009_account_management.sql').read_text(encoding='utf-8'))
        print('Migration 009 applied. Existing accounts and reports were preserved.')
    except Exception as error:
        print('Migration 009 failed ('+type(error).__name__+'). Check database access and migration 008. Keep the backend stopped until this succeeds.')
        raise SystemExit(1)

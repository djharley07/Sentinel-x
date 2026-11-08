from pathlib import Path
from app.database import get_connection
if __name__=='__main__':
    try:
        with get_connection() as conn:
            conn.execute((Path(__file__).resolve().parents[1]/'database/migrations/013_machine_references.sql').read_text(encoding='utf-8'))
        print('Migration 013 applied. Existing machines, reports, accounts and assignments were preserved.')
    except Exception as error:
        print('Migration 013 failed ('+type(error).__name__+'). Keep the backend stopped and check database access and migrations 008–012.')
        raise SystemExit(1)

from pathlib import Path
from app.database import get_connection
if __name__=='__main__':
    try:
        with get_connection() as conn:
            conn.execute((Path(__file__).resolve().parents[1]/'database/migrations/012_machine_management.sql').read_text(encoding='utf-8'))
        print('Migration 012 applied. Existing machines, accounts, assignments, reports and work history were preserved.')
    except Exception as error:
        print('Migration 012 failed ('+type(error).__name__+'). Keep the backend stopped and check database access and migrations 008–011.')
        raise SystemExit(1)

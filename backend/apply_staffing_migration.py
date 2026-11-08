from pathlib import Path
from app.database import get_connection
if __name__=='__main__':
    try:
        with get_connection() as conn:
            conn.execute((Path(__file__).resolve().parents[1]/'database/migrations/010_worker_machines.sql').read_text(encoding='utf-8'))
        print('Migration 010 applied. Existing accounts, reports and repair logs were preserved.')
    except Exception as error:
        print('Migration 010 failed ('+type(error).__name__+'). Check database access and migrations 008–009. Keep the backend stopped until this succeeds.')
        raise SystemExit(1)

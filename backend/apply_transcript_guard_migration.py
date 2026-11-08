from pathlib import Path
from app.database import get_connection
if __name__=='__main__':
    try:
        with get_connection() as conn:
            conn.execute((Path(__file__).resolve().parents[1]/'database/migrations/011_transcript_corrections.sql').read_text(encoding='utf-8'))
        print('Migration 011 applied. Existing reports, reviews and repair records were preserved.')
    except Exception as error:
        print('Migration 011 failed ('+type(error).__name__+'). Keep the backend stopped and check database access and migrations 008–010.')
        raise SystemExit(1)

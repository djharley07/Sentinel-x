import os
from pathlib import Path
from uuid import UUID, uuid4

from app.database import get_connection, get_demo_organization_id
from app.identity import principal
from app.access import require_owned

ROOT = Path(__file__).resolve().parents[2]
RECORDINGS_DIR = ROOT / "demo-assets" / "local" / "recordings"


class ReplacementError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _replacement_target(connection, organization_id, previous_attempt_id):
    previous = connection.execute(
        """SELECT report_id FROM sentinel.transcription_attempts
           WHERE id = %s AND organization_id = %s""",
        (previous_attempt_id, organization_id),
    ).fetchone()
    if previous is None:
        raise ReplacementError(404, "Previous attempt not found.")

    require_owned(connection, 'report', previous[0])

    # All replacement writers lock the same report before checking its latest attempt.
    report = connection.execute(
        """SELECT id FROM sentinel.reports
           WHERE id = %s AND organization_id = %s FOR UPDATE""",
        (previous[0], organization_id),
    ).fetchone()
    if report is None:
        raise ReplacementError(404, "Report not found.")

    latest = connection.execute(
        """SELECT id, attempt_number FROM sentinel.transcription_attempts
           WHERE report_id = %s AND organization_id = %s
           ORDER BY attempt_number DESC LIMIT 1""",
        (report[0], organization_id),
    ).fetchone()
    if latest is None or latest[0] != previous_attempt_id:
        raise ReplacementError(409, "This attempt already has a newer recording. Check the report history.")

    review = connection.execute(
        """SELECT decision FROM sentinel.transcription_reviews
           WHERE attempt_id = %s AND organization_id = %s""",
        (previous_attempt_id, organization_id),
    ).fetchone()
    if review is None or review[0] != "rerecord_requested":
        raise ReplacementError(409, "Request a re-record for this attempt before replacing it.")
    return report[0], latest[1] + 1


def _require_demo(connection, organization_id):
    organization = connection.execute(
        "SELECT is_demo FROM sentinel.organizations WHERE id = %s FOR SHARE",
        (organization_id,),
    ).fetchone()
    if organization is None or organization[0] is not True:
        raise RuntimeError("A valid demo organization is required.")


def check_replacement(previous_attempt_id: UUID):
    organization_id = get_demo_organization_id()
    with get_connection() as connection:
        _require_demo(connection, organization_id)
        _replacement_target(connection, organization_id, previous_attempt_id)
    # Release locks before calling the external speech provider.


def save_transcription(
    audio_bytes: bytes,
    extension: str,
    transcript: str,
    model: str,
    language: str | None,
    provider_request_id: str | None,
    replaces_attempt_id: UUID | None = None,
):
    organization_id = get_demo_organization_id()
    report_id = uuid4()
    attempt_number = 1
    attempt_id = uuid4()

    if extension not in {".wav", ".mp3", ".m4a", ".ogg", ".flac", ".aac"}:
        raise ValueError("Unsupported recording extension.")

    if not transcript.strip():
        raise ValueError("Cannot save an empty transcript.")

    # Generated filenames avoid using untrusted uploaded filenames.
    audio_filename = f"{attempt_id}{extension}"
    audio_path = RECORDINGS_DIR / audio_filename
    storage_key = f"local:recordings/{audio_filename}"

    with get_connection() as connection:
        _require_demo(connection, organization_id)
        if replaces_attempt_id is not None:
            # Recheck after transcription: another request may have saved first.
            report_id, attempt_number = _replacement_target(
                connection, organization_id, replaces_attempt_id
            )

        RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)

        # Save the original recording before creating its database reference.
        with audio_path.open("xb") as recording:
            recording.write(audio_bytes)
            recording.flush()
            os.fsync(recording.fileno())

        if replaces_attempt_id is None:
            connection.execute(
                """
                INSERT INTO sentinel.reports (id, organization_id, created_by_account_id)
                VALUES (%s, %s, %s)
                """,
                (report_id, organization_id, principal().account_id),
            )

        connection.execute(
            """
            INSERT INTO sentinel.transcription_attempts (
                id,
                organization_id,
                report_id,
                attempt_number,
                original_transcript,
                model,
                detected_language_code,
                provider_request_id,
                audio_storage_key
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                attempt_id,
                organization_id,
                report_id,
                attempt_number,
                transcript,
                model,
                language,
                provider_request_id,
                storage_key,
            ),
        )

    # The connection context commits both database inserts together.
    return {
        "report_id": str(report_id),
        "attempt_id": str(attempt_id),
        "attempt_number": attempt_number,
    }

def save_typed_report(text: str, request_id: UUID, replaces_attempt_id: UUID | None = None):
    """Save an explicitly typed draft, with retry identity and the existing review flow."""
    user = principal()
    organization_id = get_demo_organization_id()
    with get_connection() as connection:
        _require_demo(connection, organization_id)
        # Serialize retries before checking the attempt UUID, including concurrent requests.
        connection.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (str(request_id),))
        previous = connection.execute(
            """SELECT a.report_id, a.attempt_number, a.original_transcript, a.model,
                      r.created_by_account_id, a.audio_storage_key
               FROM sentinel.transcription_attempts a JOIN sentinel.reports r ON r.id=a.report_id
               WHERE a.id=%s AND a.organization_id=%s""", (request_id, organization_id),
        ).fetchone()
        if previous:
            if previous[2] != text or previous[3] != 'manual-text' or previous[5] != f'typed:{user.account_id}:{request_id}':
                raise ReplacementError(409, "This submission ID was already used for a different report.")
            if replaces_attempt_id is not None:
                source = connection.execute(
                    "SELECT report_id, attempt_number FROM sentinel.transcription_attempts WHERE id=%s AND organization_id=%s",
                    (replaces_attempt_id, organization_id),
                ).fetchone()
                if source is None or source[0] != previous[0] or source[1] + 1 != previous[1]:
                    raise ReplacementError(409, "This submission ID belongs to a different replacement.")
            elif previous[1] != 1:
                raise ReplacementError(409, "This submission ID belongs to a replacement.")
            return {"report_id": str(previous[0]), "attempt_id": str(request_id), "attempt_number": previous[1]}
        report_id, attempt_number = uuid4(), 1
        if replaces_attempt_id is not None:
            report_id, attempt_number = _replacement_target(connection, organization_id, replaces_attempt_id)
        else:
            connection.execute(
                "INSERT INTO sentinel.reports(id, organization_id, created_by_account_id) VALUES(%s,%s,%s)",
                (report_id, organization_id, user.account_id),
            )
        connection.execute(
            """INSERT INTO sentinel.transcription_attempts
               (id, organization_id, report_id, attempt_number, original_transcript, model, audio_storage_key)
               VALUES(%s,%s,%s,%s,%s,'manual-text',%s)""",
            (request_id, organization_id, report_id, attempt_number, text, f"typed:{user.account_id}:{request_id}"),
        )
    return {"report_id": str(report_id), "attempt_id": str(request_id), "attempt_number": attempt_number}

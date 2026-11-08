import logging
from typing import Literal
from uuid import UUID

import psycopg
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.database import get_connection, get_demo_organization_id
from app.equipment_check import require_latest, equipment_warnings, available_machines

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/attempts", tags=["Transcript reviews"])


class ReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["accepted", "corrected", "rerecord_requested"]
    corrected_transcript: str | None = Field(default=None, max_length=20000)
    equipment_check_acknowledged: bool = False


@router.post("/{attempt_id}/review")
def review_transcript(attempt_id: UUID, review: ReviewRequest):
    corrected = review.corrected_transcript

    if review.decision == "corrected":
        if corrected is None or not corrected.strip():
            raise HTTPException(
                status_code=422,
                detail="Enter the corrected transcript.",
            )
        corrected = corrected.strip()
    elif corrected is not None:
        raise HTTPException(
            status_code=422,
            detail="Only a corrected review may include corrected text.",
        )

    try:
        organization_id = get_demo_organization_id()

        with get_connection() as connection:
            organization = connection.execute(
                """
                SELECT is_demo
                FROM sentinel.organizations
                WHERE id = %s
                FOR SHARE
                """,
                (organization_id,),
            ).fetchone()

            if organization is None or organization[0] is not True:
                raise HTTPException(
                    status_code=503,
                    detail="A valid demo organization is required.",
                )

            # All version writers lock the report before the attempt.
            require_latest(connection, attempt_id, lock=True)
            # Serialize review requests for this attempt.
            attempt = connection.execute(
                """
                SELECT report_id, original_transcript
                FROM sentinel.transcription_attempts
                WHERE id = %s AND organization_id = %s
                FOR UPDATE
                """,
                (attempt_id, organization_id),
            ).fetchone()

            if attempt is None:
                raise HTTPException(
                    status_code=404,
                    detail="Transcription attempt not found.",
                )

            existing = connection.execute(
                """
                SELECT id, decision, corrected_transcript
                FROM sentinel.transcription_reviews
                WHERE attempt_id = %s AND organization_id = %s
                """,
                (attempt_id, organization_id),
            ).fetchone()

            if existing is not None:
                # An identical retry returns the existing review.
                if (
                    existing[1] != review.decision
                    or existing[2] != corrected
                ):
                    raise HTTPException(
                        status_code=409,
                        detail="This attempt already has a different review.",
                    )
                review_id = existing[0]
            else:
                if review.decision != 'rerecord_requested':
                    check_text = corrected if review.decision == 'corrected' else attempt[1]
                    if equipment_warnings(check_text, available_machines(connection)) and not review.equipment_check_acknowledged:
                        raise HTTPException(422, 'Check the possible equipment-name mismatch before saving.')
                inserted = connection.execute(
                    """
                    INSERT INTO sentinel.transcription_reviews (
                        organization_id,
                        attempt_id,
                        decision,
                        corrected_transcript,
                        review_source
                    )
                    VALUES (%s, %s, %s, %s, 'local_demo')
                    RETURNING id
                    """,
                    (
                        organization_id,
                        attempt_id,
                        review.decision,
                        corrected,
                    ),
                ).fetchone()
                review_id = inserted[0]

            if review.decision == "accepted":
                verified_transcript = attempt[1]
            elif review.decision == "corrected":
                verified_transcript = corrected
            else:
                verified_transcript = None

            result = {
                "review_id": str(review_id),
                "report_id": str(attempt[0]),
                "attempt_id": str(attempt_id),
                "decision": review.decision,
                "original_transcript": attempt[1],
                "verified_transcript": verified_transcript,
                "review_source": "local_demo",
                "persistence_status": "saved",
            }

        # Return success only after the transaction commits.
        return result

    except (psycopg.Error, OSError, RuntimeError, ValueError) as error:
        logger.error("Review persistence failed: %s", type(error).__name__)
        raise HTTPException(
            status_code=503,
            detail=(
                "Review saving could not be confirmed. "
                "Retry the same review without changing its contents."
            ),
        ) from None
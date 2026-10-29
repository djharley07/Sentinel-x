"""Read-only history for the configured local demo organization."""
import logging
from contextlib import contextmanager
from typing import Annotated
from uuid import UUID

import psycopg
from fastapi import APIRouter, HTTPException, Query
from psycopg.rows import dict_row

from app.database import get_connection, get_demo_organization_id

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/reports", tags=["Report history"])


@contextmanager
def history_cursor():
    try:
        organization_id = get_demo_organization_id()
        with get_connection() as connection:
            # One consistent snapshot; these endpoints cannot write records.
            connection.execute(
                "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"
            )
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    "SELECT is_demo FROM sentinel.organizations WHERE id = %s",
                    (organization_id,),
                )
                organization = cursor.fetchone()
                if organization is None or organization["is_demo"] is not True:
                    raise HTTPException(503, detail="A valid demo organization is required.")
                yield cursor, organization_id
    except (psycopg.Error, OSError, RuntimeError, ValueError) as error:
        logger.error("Report history failed: %s", type(error).__name__)
        raise HTTPException(
            503, detail="Could not load report history. Try again shortly."
        ) from None


@router.get("")
def list_reports(
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    with history_cursor() as (cursor, organization_id):
        cursor.execute(
            "SELECT count(*) AS total FROM sentinel.reports WHERE organization_id = %s",
            (organization_id,),
        )
        total = cursor.fetchone()["total"]
        cursor.execute(
            """
            SELECT
                r.id AS report_id,
                r.created_at,
                a.id AS latest_attempt_id,
                a.attempt_number AS latest_attempt_number,
                a.original_transcript AS latest_original_transcript,
                a.detected_language_code,
                COALESCE(v.decision, 'pending') AS verification_status
            FROM sentinel.reports AS r
            LEFT JOIN LATERAL (
                SELECT id, attempt_number, original_transcript, detected_language_code
                FROM sentinel.transcription_attempts
                WHERE report_id = r.id AND organization_id = r.organization_id
                ORDER BY attempt_number DESC
                LIMIT 1
            ) AS a ON true
            LEFT JOIN sentinel.transcription_reviews AS v
                ON v.attempt_id = a.id AND v.organization_id = r.organization_id
            WHERE r.organization_id = %s
            ORDER BY r.created_at DESC, r.id DESC
            LIMIT %s OFFSET %s
            """,
            (organization_id, limit, offset),
        )
        reports = cursor.fetchall()
    return {
        "reports": reports,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(reports) < total,
    }


@router.get("/{report_id}")
def get_report(report_id: UUID):
    with history_cursor() as (cursor, organization_id):
        cursor.execute(
            """SELECT id AS report_id, created_at FROM sentinel.reports
               WHERE id = %s AND organization_id = %s""",
            (report_id, organization_id),
        )
        report = cursor.fetchone()
        if report is None:
            raise HTTPException(404, detail="Report not found.")
        cursor.execute(
            """
            SELECT
                a.id AS attempt_id,
                a.attempt_number,
                a.created_at,
                a.original_transcript,
                a.model,
                a.detected_language_code,
                a.provider_request_id AS request_id,
                COALESCE(v.decision, 'pending') AS verification_status,
                v.id AS review_id,
                v.decision,
                v.corrected_transcript,
                v.review_source,
                v.created_at AS reviewed_at,
                CASE
                    WHEN v.decision = 'accepted' THEN a.original_transcript
                    WHEN v.decision = 'corrected' THEN v.corrected_transcript
                    ELSE NULL
                END AS verified_transcript
            FROM sentinel.transcription_attempts AS a
            LEFT JOIN sentinel.transcription_reviews AS v
                ON v.attempt_id = a.id AND v.organization_id = a.organization_id
            WHERE a.report_id = %s AND a.organization_id = %s
            ORDER BY a.attempt_number ASC
            """,
            (report_id, organization_id),
        )
        attempts = cursor.fetchall()
    return {**report, "attempts": attempts}

"""One immutable AI extraction per reviewed attempt, for the local demo."""
import logging
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb
from fastapi import APIRouter, HTTPException, Response

from app.database import get_connection, get_demo_organization_id
from app.equipment_check import require_latest
from app.extraction import reviewed_source, extract_facts

router = APIRouter(prefix='/api/attempts', tags=['Saved extractions'])
logger = logging.getLogger(__name__)


def stored_result(row):
    return {
        **row[1], 'extraction_id': str(row[0]),
        'created_at': row[2].isoformat(),
        'persistence_status': 'saved', 'requires_human_review': True,
    }


def lookup(attempt_id, organization_id):
    with get_connection() as connection:
        connection.execute('SET TRANSACTION READ ONLY')
        return connection.execute(
            '''SELECT id, payload, created_at FROM sentinel.report_extractions
               WHERE attempt_id = %s AND organization_id = %s''',
            (attempt_id, organization_id),
        ).fetchone()


def unavailable(error):
    logger.error('Extraction persistence failed: %s', type(error).__name__)
    return HTTPException(503, 'Could not confirm the saved extraction. Check saved results before retrying. Ensure migration 002 has been applied.')


@router.get('/{attempt_id}/extraction')
def get_extraction(attempt_id: UUID, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    # Establish organization scope and review eligibility even for a cached result.
    reviewed_source(attempt_id)
    try:
        row = lookup(attempt_id, get_demo_organization_id())
        return {'extraction': stored_result(row) if row else None}
    except (psycopg.Error, OSError, RuntimeError, ValueError) as error:
        raise unavailable(error) from None


@router.post('/{attempt_id}/extraction')
def save_extraction(attempt_id: UUID, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    source = reviewed_source(attempt_id)
    try:
        organization_id = get_demo_organization_id()
        row = lookup(attempt_id, organization_id)
        if row:
            return {'extraction': stored_result(row)}
        # No database transaction or lock is held during the provider call.
        result = extract_facts(source['verified_transcript'])
        if reviewed_source(attempt_id) != source:
            raise HTTPException(409, 'The reviewed source changed. Reload the report.')
        payload = {**source, **result, 'schema_version': 'maintenance-facts-v1'}
        with get_connection() as connection:
            require_latest(connection,attempt_id,lock=True)
            # A concurrent request may finish first. Keep its result unchanged.
            connection.execute(
                '''INSERT INTO sentinel.report_extractions
                   (organization_id, attempt_id, payload) VALUES (%s, %s, %s)
                   ON CONFLICT (attempt_id) DO NOTHING''',
                (organization_id, attempt_id, Jsonb(payload)),
            )
            row = connection.execute(
                '''SELECT id, payload, created_at FROM sentinel.report_extractions
                   WHERE attempt_id = %s AND organization_id = %s''',
                (attempt_id, organization_id),
            ).fetchone()
            if row is None:
                raise RuntimeError('Missing saved extraction')
            saved = stored_result(row)
        # Only return success after commit.
        return {'extraction': saved}
    except (psycopg.Error, OSError, RuntimeError, ValueError) as error:
        raise unavailable(error) from None

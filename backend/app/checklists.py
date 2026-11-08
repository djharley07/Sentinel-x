"""Machine checklist publishing and immutable worker submissions."""
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.database import get_connection
from app.identity import principal
from app.worker_machines import can_select_machine, worker_row

router = APIRouter(prefix='/api/checklists', tags=['Pre-use checklists'])
DEFAULT_ITEMS = [
    'Site procedure: Is the approved pre-use checklist available for this machine?',
    'Shift handover: Were any unresolved concerns reported by the previous shift?',
    'Existing warnings: Are any warning tags, alerts, or restrictions already visible?',
    'Visible concerns: Did you notice anything unusual from your normal work area?',
    'Site-specific checks: Did any required check from the site procedure raise a concern or remain unverified?',
]
Item = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=250)]
Answer = Literal['no_concern', 'concern', 'unsure']


class Publish(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_version: int = Field(ge=0, strict=True)
    items: list[Item] = Field(min_length=1, max_length=20)


class Submission(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    request_id: UUID
    version: int = Field(ge=0, strict=True)
    answers: list[Answer] = Field(min_length=1, max_length=20)
    note: str = Field(default='', max_length=500)


def account_for(*roles):
    user = principal()
    if user.role not in roles:
        raise HTTPException(403, 'Your account cannot perform this checklist action.')
    return user


def machine_row(conn, org, machine_id, lock=''):
    row = conn.execute(
        'SELECT name, code FROM sentinel.machines WHERE organization_id=%s AND id=%s AND active' + lock,
        (org, machine_id),
    ).fetchone()
    if not row:
        raise HTTPException(404, 'Choose an active machine.')
    return row


def template(conn, org, machine_id):
    row = conn.execute(
        '''SELECT version, items FROM sentinel.checklist_versions
        WHERE organization_id=%s AND machine_id=%s ORDER BY version DESC LIMIT 1''',
        (org, machine_id),
    ).fetchone()
    return {'version': row[0], 'items': row[1]} if row else {'version': 0, 'items': DEFAULT_ITEMS}


@router.get('/template/{machine_id}')
def get_template(machine_id: UUID):
    user = account_for('owner', 'worker')
    with get_connection() as conn:
        can_select_machine(conn, machine_id)
        machine_row(conn, user.organization_id, machine_id, ' FOR SHARE')
        return {**template(conn, user.organization_id, machine_id), 'default_items': DEFAULT_ITEMS}


@router.post('/template/{machine_id}')
def publish(machine_id: UUID, body: Publish):
    user = account_for('owner')
    org = user.organization_id
    if len({item.casefold() for item in body.items}) != len(body.items):
        raise HTTPException(422, 'Checklist items must be distinct.')
    with get_connection() as conn:
        machine_row(conn, org, machine_id, ' FOR UPDATE')
        current = template(conn, org, machine_id)
        if current['version'] > 0 and current['items'] == body.items:
            return current
        if current['version'] != body.expected_version:
            raise HTTPException(409, 'The checklist changed. Reload it before publishing.')
        version = current['version'] + 1
        conn.execute(
            '''INSERT INTO sentinel.checklist_versions
            (organization_id,machine_id,version,items,published_by) VALUES (%s,%s,%s,%s,%s)''',
            (org, machine_id, version, Jsonb(body.items), user.account_id),
        )
        return {'version': version, 'items': body.items}


@router.post('/submit/{machine_id}')
def submit(machine_id: UUID, body: Submission):
    user = account_for('worker')
    org = user.organization_id
    with get_connection() as conn:
        name, enabled = worker_row(conn, user, user.account_id, lock=True)
        if not enabled:
            raise HTTPException(403, 'An active worker account is required.')
        prior = conn.execute(
            '''SELECT machine_id,version,answers,note,submitted_at
            FROM sentinel.checklist_submissions WHERE id=%s AND organization_id=%s AND worker_id=%s''',
            (body.request_id, org, user.account_id),
        ).fetchone()
        if prior:
            if prior[:4] != (machine_id, body.version, body.answers, body.note):
                raise HTTPException(409, 'Submission ID already used for different answers.')
            return {'id': body.request_id, 'submitted_at': prior[4]}
        can_select_machine(conn, machine_id)
        machine_name, machine_code = machine_row(conn, org, machine_id, ' FOR SHARE')
        current = template(conn, org, machine_id)
        if current['version'] != body.version:
            raise HTTPException(409, 'The checklist changed. Reload it and review the new items.')
        if len(body.answers) != len(current['items']):
            raise HTTPException(422, 'Answer every checklist item before submitting.')
        saved = conn.execute(
            '''INSERT INTO sentinel.checklist_submissions
            (id,organization_id,machine_id,worker_id,worker_name,machine_name,machine_code,
             version,items,answers,note,needs_review)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (id) DO NOTHING RETURNING submitted_at''',
            (body.request_id, org, machine_id, user.account_id, name, machine_name, machine_code,
             body.version, Jsonb(current['items']), Jsonb(body.answers), body.note,
             any(answer != 'no_concern' for answer in body.answers)),
        ).fetchone()
        if not saved:
            raise HTTPException(409, 'Submission ID already used.')
        return {'id': body.request_id, 'submitted_at': saved[0]}


class ReportLink(BaseModel):
    model_config = ConfigDict(extra='forbid')
    report_id: UUID


@router.post('/link/{submission_id}')
def link_report(submission_id: UUID, body: ReportLink):
    user = account_for('worker')
    org = user.organization_id
    with get_connection() as conn:
        submission = conn.execute(
            '''SELECT submitted_at FROM sentinel.checklist_submissions
            WHERE id=%s AND organization_id=%s AND worker_id=%s AND needs_review FOR UPDATE''',
            (submission_id, org, user.account_id),
        ).fetchone()
        if not submission:
            raise HTTPException(404, 'A flagged checklist submitted by your account is required.')
        prior = conn.execute(
            'SELECT report_id FROM sentinel.checklist_report_links WHERE submission_id=%s AND organization_id=%s',
            (submission_id, org),
        ).fetchone()
        if prior:
            if prior[0] == body.report_id:
                return {'report_id': body.report_id}
            raise HTTPException(409, 'This checklist already has a linked report.')
        report = conn.execute(
            '''SELECT p.id FROM sentinel.reports p
            JOIN LATERAL (
                SELECT id FROM sentinel.transcription_attempts
                WHERE report_id=p.id AND organization_id=p.organization_id
                ORDER BY attempt_number DESC LIMIT 1
            ) attempt ON true
            JOIN sentinel.transcription_reviews v
              ON v.organization_id=p.organization_id AND v.attempt_id=attempt.id
            WHERE p.id=%s AND p.organization_id=%s AND p.created_by_account_id=%s
              AND p.created_at >= %s AND v.decision IN ('accepted','corrected')
            FOR UPDATE OF p''',
            (body.report_id, org, user.account_id, submission[0]),
        ).fetchone()
        if not report:
            raise HTTPException(422, 'Verify a new report from your account before linking it.')
        saved = conn.execute(
            '''INSERT INTO sentinel.checklist_report_links (submission_id,organization_id,report_id)
            VALUES (%s,%s,%s) ON CONFLICT DO NOTHING RETURNING report_id''',
            (submission_id, org, body.report_id),
        ).fetchone()
        if not saved:
            raise HTTPException(409, 'This report is already linked to a checklist.')
        return {'report_id': saved[0]}


@router.get('/submissions')
def submissions(needs_review: bool = False, offset: int = Query(0, ge=0)):
    user = account_for('owner')
    with get_connection() as conn, conn.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            '''SELECT s.id,s.machine_id,s.machine_name,s.machine_code,s.worker_name,s.version,
            s.items,s.answers,s.note,s.needs_review,s.submitted_at,l.report_id
            FROM sentinel.checklist_submissions s
            LEFT JOIN sentinel.checklist_report_links l ON l.submission_id=s.id AND l.organization_id=s.organization_id
            WHERE s.organization_id=%s AND (NOT %s OR s.needs_review)
            ORDER BY s.submitted_at DESC,s.id DESC LIMIT 21 OFFSET %s''',
            (user.organization_id, needs_review, offset),
        )
        rows = cursor.fetchall()
    return {'submissions': rows[:20], 'has_more': len(rows) > 20}

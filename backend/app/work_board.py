"""Owner view of the latest report versions and their saved work status."""
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Response

from app.history import history_cursor
from app.identity import principal

router = APIRouter(prefix='/api', tags=['Owner Work Board'])

BOARD = """
WITH board AS (
  SELECT p.id AS report_id, a.attempt_number,
    coalesce(tr.corrected_transcript, a.original_transcript) AS transcript,
    coalesce(tr.decision, 'pending') AS verification_status,
    r.id IS NOT NULL AS reviewed, r.facts->>'reported_issue' AS reported_issue,
    m.name AS machine_name, m.code AS machine_code,
    t.name AS technician_name, t.code AS technician_code,
    coalesce(w.status, 'unassigned') AS status, w.outcome, w.action_note,
    CASE WHEN w.status='completed' THEN w.created_at END AS completed_at,
    greatest(p.created_at, a.created_at, tr.created_at, x.created_at, r.created_at,
             l.created_at, w.created_at) AS updated_at,
    CASE WHEN w.status='in_progress' THEN 'live'
         WHEN w.status='completed' THEN 'done' ELSE 'new' END AS folder
  FROM sentinel.reports p
  LEFT JOIN LATERAL (
    SELECT * FROM sentinel.transcription_attempts a
    WHERE a.organization_id=p.organization_id AND a.report_id=p.id
    ORDER BY a.attempt_number DESC LIMIT 1
  ) a ON true
  LEFT JOIN sentinel.transcription_reviews tr
    ON tr.organization_id=p.organization_id AND tr.attempt_id=a.id
  LEFT JOIN sentinel.report_extractions x
    ON x.organization_id=p.organization_id AND x.attempt_id=a.id
  LEFT JOIN sentinel.extraction_reviews r
    ON r.organization_id=p.organization_id AND r.extraction_id=x.id
  LEFT JOIN LATERAL (
    SELECT * FROM sentinel.machine_link_events l
    WHERE l.organization_id=p.organization_id AND l.review_id=r.id
    ORDER BY l.sequence_number DESC LIMIT 1
  ) l ON true
  LEFT JOIN sentinel.machines m ON m.organization_id=p.organization_id
    AND m.id=CASE WHEN l.id IS NOT NULL THEN l.machine_id ELSE r.machine_id END
  LEFT JOIN LATERAL (
    SELECT * FROM sentinel.repair_events w
    WHERE w.organization_id=p.organization_id AND w.review_id=r.id
    ORDER BY w.sequence_number DESC LIMIT 1
  ) w ON true
  LEFT JOIN sentinel.technicians t ON t.organization_id=p.organization_id AND t.id=w.technician_id
  WHERE p.organization_id=%(org)s
)
SELECT * FROM board b
WHERE (%(folder)s='all' OR b.folder=%(folder)s)
AND (%(query)s='' OR strpos(lower(concat_ws(' ', b.report_id, b.transcript,
    b.reported_issue, b.machine_name, b.machine_code, b.technician_name,
    b.technician_code, b.action_note)), lower(%(query)s)) > 0
 OR (%(folder)s='all' AND EXISTS (
    SELECT 1 FROM sentinel.transcription_attempts a
    LEFT JOIN sentinel.transcription_reviews tr
      ON tr.organization_id=a.organization_id AND tr.attempt_id=a.id
    LEFT JOIN sentinel.report_extractions x
      ON x.organization_id=a.organization_id AND x.attempt_id=a.id
    LEFT JOIN sentinel.extraction_reviews r
      ON r.organization_id=a.organization_id AND r.extraction_id=x.id
    LEFT JOIN sentinel.repair_events w
      ON w.organization_id=a.organization_id AND w.review_id=r.id
    LEFT JOIN sentinel.technicians t
      ON t.organization_id=a.organization_id AND t.id=w.technician_id
    LEFT JOIN sentinel.machines m
      ON m.organization_id=a.organization_id AND m.id=coalesce(w.machine_id,r.machine_id)
    WHERE a.organization_id=%(org)s AND a.report_id=b.report_id
    AND (EXISTS (
      SELECT 1 FROM sentinel.machine_link_events ml
      JOIN sentinel.machines lm ON lm.organization_id=ml.organization_id AND lm.id=ml.machine_id
      WHERE ml.organization_id=a.organization_id AND ml.review_id=r.id
      AND strpos(lower(concat_ws(' ', lm.name, lm.code)), lower(%(query)s)) > 0
    ) OR strpos(lower(concat_ws(' ', a.original_transcript, tr.corrected_transcript,
      r.facts->>'reported_issue', r.facts->>'equipment_label',
      m.name, m.code, w.action_note, t.name, t.code)), lower(%(query)s)) > 0)
 )))
ORDER BY updated_at DESC, report_id DESC
LIMIT 21 OFFSET %(offset)s
"""


@router.get('/owner-work-board')
def owner_work_board(
    response: Response,
    folder: Literal['new', 'live', 'done', 'all'] = 'new',
    q: str = Query('', max_length=150),
    offset: int = Query(0, ge=0),
):
    if principal().role != 'owner':
        raise HTTPException(403, 'Only the factory owner can view the work board.')
    response.headers['Cache-Control'] = 'no-store'
    with history_cursor() as (cursor, org):
        cursor.execute(BOARD, {'org': org, 'folder': folder, 'query': q.strip(), 'offset': offset})
        rows = cursor.fetchall()
    return {'reports': rows[:20], 'has_more': len(rows) > 20}

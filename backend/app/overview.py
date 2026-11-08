"""Read-only factory overview, all queries share a repeatable-read snapshot."""
from fastapi import APIRouter, Query, Response
from app.history import history_cursor
router=APIRouter(prefix='/api',tags=['Factory overview'])
REVIEWED='''
WITH reviewed AS (
 SELECT r.id AS review_id,a.report_id,r.facts,
 CASE WHEN link.id IS NOT NULL THEN link.machine_id ELSE r.machine_id END AS machine_id,
 red.status AS redline_status,red.note,red.created_at AS updated_at
 FROM sentinel.extraction_reviews r
 JOIN sentinel.report_extractions x ON x.id=r.extraction_id AND x.organization_id=r.organization_id
 JOIN sentinel.transcription_attempts a ON a.id=x.attempt_id AND a.organization_id=x.organization_id
 LEFT JOIN LATERAL (SELECT id,machine_id FROM sentinel.machine_link_events e WHERE e.review_id=r.id AND e.organization_id=r.organization_id ORDER BY sequence_number DESC LIMIT 1) link ON true
 LEFT JOIN LATERAL (SELECT status,note,created_at FROM sentinel.redline_events e WHERE e.review_id=r.id AND e.organization_id=r.organization_id ORDER BY sequence_number DESC LIMIT 1) red ON true
 WHERE r.organization_id=%s
)
'''

@router.get('/overview')
def overview(response:Response,offset:int=Query(0,ge=0)):
    response.headers['Cache-Control']='no-store'
    with history_cursor() as (cur,org):
        cur.execute('SELECT name FROM sentinel.organizations WHERE id=%s',(org,))
        name=cur.fetchone()['name']
        cur.execute('''SELECT count(*) AS total_reports,
          count(*) FILTER (WHERE a.id IS NOT NULL AND r.decision IS NULL) AS pending_transcripts,
          count(*) FILTER (WHERE r.decision='rerecord_requested') AS rerecord_requested
          FROM sentinel.reports p
          LEFT JOIN LATERAL (SELECT id FROM sentinel.transcription_attempts WHERE report_id=p.id AND organization_id=p.organization_id ORDER BY attempt_number DESC LIMIT 1) a ON true
          LEFT JOIN sentinel.transcription_reviews r ON r.attempt_id=a.id AND r.organization_id=p.organization_id
          WHERE p.organization_id=%s''',(org,))
        counts=dict(cur.fetchone())
        cur.execute(REVIEWED+'''SELECT count(DISTINCT report_id) AS reviewed_reports,
           count(*) FILTER (WHERE redline_status IN ('open','acknowledged')) AS active_redlines,
           count(*) FILTER (WHERE machine_id IS NULL) AS unlinked_reviews FROM reviewed''',(org,))
        counts.update(cur.fetchone())
        cur.execute(REVIEWED+'''SELECT m.id AS machine_id,m.code,m.name,m.department,
           count(DISTINCT r.report_id) AS report_count,
           count(DISTINCT r.report_id) FILTER (WHERE r.redline_status IN ('open','acknowledged')) AS active_redlines
           FROM sentinel.machines m LEFT JOIN reviewed r ON r.machine_id=m.id
           WHERE m.organization_id=%s GROUP BY m.id,m.code,m.name,m.department ORDER BY m.code''',(org,org))
        machines=cur.fetchall()
        cur.execute(REVIEWED+'''SELECT r.review_id,r.report_id,r.facts->>'reported_issue' AS reported_issue,
            r.redline_status,r.note,r.updated_at,m.name AS machine_name,m.code AS machine_code
            FROM reviewed r LEFT JOIN sentinel.machines m ON m.id=r.machine_id AND m.organization_id=%s
            WHERE r.redline_status IN ('open','acknowledged')
            ORDER BY CASE r.redline_status WHEN 'open' THEN 0 ELSE 1 END,r.updated_at DESC,r.review_id DESC LIMIT 21 OFFSET %s''',(org,org,offset))
        active=cur.fetchall()
        cur.execute('''SELECT p.id AS report_id,p.created_at,a.attempt_number,a.original_transcript,
          coalesce(r.decision,'pending') AS verification_status
          FROM sentinel.reports p LEFT JOIN LATERAL (
           SELECT id,attempt_number,original_transcript FROM sentinel.transcription_attempts
           WHERE report_id=p.id AND organization_id=p.organization_id ORDER BY attempt_number DESC LIMIT 1) a ON true
          LEFT JOIN sentinel.transcription_reviews r ON r.attempt_id=a.id AND r.organization_id=p.organization_id
          WHERE p.organization_id=%s ORDER BY p.created_at DESC,p.id DESC LIMIT 10''',(org,))
        recent=cur.fetchall()
    return {'organization_name':name,'counts':counts,'machines':machines,'active_redlines':active[:20],
      'redline_offset':offset,'redline_has_more':len(active)>20,'recent_reports':recent}

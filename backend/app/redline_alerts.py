"""Owner inbox for existing manual REDLINE cases; preserves earlier report-version cases."""
from datetime import datetime,timezone
from uuid import UUID
from fastapi import APIRouter,HTTPException,Query
from app.database import get_connection
from app.identity import principal

router=APIRouter(prefix='/api/redline-alerts',tags=['Owner REDLINE inbox'])
BASE='''WITH cases AS (
 SELECT r.id AS review_id,a.report_id,a.id AS attempt_id,a.attempt_number,
   (SELECT max(v.attempt_number) FROM sentinel.transcription_attempts v
      WHERE v.report_id=a.report_id AND v.organization_id=a.organization_id) AS latest_attempt_number,
   red.id AS event_id,red.status,red.note,red.created_at AS updated_at,
   CASE WHEN link.id IS NOT NULL THEN link.machine_id ELSE r.machine_id END AS machine_id,
   m.name AS machine_name,m.code AS machine_code,m.department,m.active AS machine_active,
   r.facts->>'reported_issue' AS reported_issue,r.facts->>'equipment_label' AS equipment_label,
   r.facts,r.created_at AS facts_reviewed_at,a.original_transcript,
   CASE WHEN tr.decision='corrected' THEN tr.corrected_transcript
        WHEN tr.decision='accepted' THEN a.original_transcript ELSE NULL END AS verified_transcript
 FROM sentinel.extraction_reviews r
 JOIN sentinel.report_extractions x ON x.id=r.extraction_id AND x.organization_id=r.organization_id
 JOIN sentinel.transcription_attempts a ON a.id=x.attempt_id AND a.organization_id=x.organization_id
 JOIN LATERAL (SELECT id,status,note,created_at FROM sentinel.redline_events e
   WHERE e.review_id=r.id AND e.organization_id=r.organization_id ORDER BY sequence_number DESC LIMIT 1) red ON true
 LEFT JOIN LATERAL (SELECT id,machine_id FROM sentinel.machine_link_events e
   WHERE e.review_id=r.id AND e.organization_id=r.organization_id ORDER BY sequence_number DESC LIMIT 1) link ON true
 LEFT JOIN sentinel.machines m ON m.id=(CASE WHEN link.id IS NOT NULL THEN link.machine_id ELSE r.machine_id END)
   AND m.organization_id=r.organization_id
 LEFT JOIN sentinel.transcription_reviews tr ON tr.attempt_id=a.id AND tr.organization_id=a.organization_id
 WHERE r.organization_id=%s
) '''
FIELDS=('review_id','report_id','attempt_id','attempt_number','latest_attempt_number','event_id','status','note','updated_at',
        'machine_id','machine_name','machine_code','department','machine_active','reported_issue','equipment_label')
SELECT=','.join(FIELDS)

def owner():
    u=principal()
    if u.role!='owner':raise HTTPException(403,'Only the factory owner can view the REDLINE inbox.')
    return u

def encode(row):
    data=dict(zip(FIELDS,row[:len(FIELDS)]))
    for key in ('review_id','report_id','attempt_id','event_id','machine_id'):
        data[key]=str(data[key]) if data[key] is not None else None
    data['updated_at']=data['updated_at'].isoformat()
    return data

def counts(conn,org):
    row=conn.execute(BASE+'''SELECT count(*) FILTER(WHERE status='open') AS open,
       count(*) FILTER(WHERE status='acknowledged') AS acknowledged,count(*) FILTER(WHERE status='resolved') AS resolved,
       count(*) FILTER(WHERE status IN ('open','acknowledged')) AS active,
       count(DISTINCT report_id) FILTER(WHERE status IN ('open','acknowledged')) AS active_reports,count(*) AS total FROM cases''',(org,)).fetchone()
    return dict(zip(('open','acknowledged','resolved','active','active_reports','total'),row))

@router.get('/summary')
def summary():
    u=owner()
    with get_connection() as conn:
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        data=counts(conn,u.organization_id)
    return {'counts':data,'checked_at':datetime.now(timezone.utc).isoformat(),'notification_status':'in_app_only'}

@router.get('')
def inbox(status:str=Query('active',pattern='^(active|open|acknowledged|resolved|all)$'),offset:int=Query(0,ge=0),limit:int=Query(20,ge=1,le=100)):
    u=owner()
    with get_connection() as conn:
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        total=counts(conn,u.organization_id)
        rows=conn.execute(BASE+'SELECT '+SELECT+''' FROM cases
          WHERE (%s='all' OR (%s='active' AND status IN ('open','acknowledged')) OR status=%s)
          ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
             updated_at DESC,review_id DESC LIMIT %s OFFSET %s''',(u.organization_id,status,status,status,limit+1,offset)).fetchall()
    return {'cases':[encode(r) for r in rows[:limit]],'counts':total,'status':status,'offset':offset,'limit':limit,
        'has_more':len(rows)>limit,'checked_at':datetime.now(timezone.utc).isoformat(),'notification_status':'in_app_only'}

@router.get('/{review_id}')
def detail(review_id:UUID):
    u=owner()
    with get_connection() as conn:
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        row=conn.execute(BASE+'SELECT '+SELECT+',facts,facts_reviewed_at,original_transcript,verified_transcript FROM cases WHERE review_id=%s',(u.organization_id,review_id)).fetchone()
    if not row:raise HTTPException(404,'Escalation not found in this factory.')
    return {'case':encode(row),'facts':row[16],'facts_reviewed_at':row[17].isoformat(),
        'original_transcript':row[18],'verified_transcript':row[19],'notification_status':'in_app_only'}

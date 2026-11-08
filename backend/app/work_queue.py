"""Read-only task queue based on each review's latest work event."""
from typing import Literal
from uuid import UUID
from fastapi import APIRouter,HTTPException,Query,Response
from app.history import history_cursor
from app.identity import principal
router=APIRouter(prefix='/api',tags=['Technician work queue'])
LATEST='''WITH latest AS (
 SELECT DISTINCT ON (e.review_id) e.* FROM sentinel.repair_events e
 WHERE e.organization_id=%s ORDER BY e.review_id,e.sequence_number DESC
), filtered AS (
 SELECT * FROM latest WHERE (%s::uuid IS NULL OR technician_id=%s::uuid)
 AND (%s='all' OR (%s='active' AND status IN ('assigned','in_progress')) OR (%s='completed' AND status='completed'))
) '''

@router.get('/work-queue')
def work_queue(response:Response,technician_id:UUID|None=None,
    status:Literal['active','completed','all']='active',offset:int=Query(0,ge=0)):
    user=principal()
    if user.role=='technician':
        if technician_id is not None and technician_id!=user.technician_id:
            raise HTTPException(403,'You can load only your own queue.')
        technician_id=user.technician_id
    response.headers['Cache-Control']='no-store'
    with history_cursor() as (cur,org):
        cur.execute('SELECT id AS technician_id,code,name FROM sentinel.technicians WHERE organization_id=%s ORDER BY code',(org,))
        technicians=cur.fetchall()
        if user.role=='technician':
            technicians=[t for t in technicians if t['technician_id']==user.technician_id]
        if technician_id is not None and not any(t['technician_id']==technician_id for t in technicians):
            raise HTTPException(404,'Demo technician not found.')
        params=(org,technician_id,technician_id,status,status,status)
        cur.execute(LATEST+'SELECT count(*) AS total FROM filtered',params)
        total=cur.fetchone()['total']
        cur.execute(LATEST+'''SELECT f.id AS event_id,f.review_id,f.status,f.action_note,f.outcome,f.created_at,
           t.name AS technician_name,t.id AS technician_id,m.name AS assigned_machine_name,m.code AS assigned_machine_code,
           a.report_id,r.facts->>'reported_issue' AS reported_issue,
           CASE WHEN link.id IS NOT NULL THEN link.machine_id ELSE r.machine_id END AS current_machine_id,
           f.machine_id AS assigned_machine_id
          FROM filtered f
          JOIN sentinel.technicians t ON t.id=f.technician_id AND t.organization_id=f.organization_id
          JOIN sentinel.machines m ON m.id=f.machine_id AND m.organization_id=f.organization_id
          JOIN sentinel.extraction_reviews r ON r.id=f.review_id AND r.organization_id=f.organization_id
          JOIN sentinel.report_extractions x ON x.id=r.extraction_id AND x.organization_id=r.organization_id
          JOIN sentinel.transcription_attempts a ON a.id=x.attempt_id AND a.organization_id=x.organization_id
          LEFT JOIN LATERAL (SELECT id,machine_id FROM sentinel.machine_link_events l
            WHERE l.review_id=r.id AND l.organization_id=r.organization_id ORDER BY sequence_number DESC LIMIT 1) link ON true
          ORDER BY CASE f.status WHEN 'in_progress' THEN 0 WHEN 'assigned' THEN 1 ELSE 2 END,f.created_at DESC,f.review_id DESC
          LIMIT 20 OFFSET %s''',params+(offset,))
        tasks=cur.fetchall()
    return {'technicians':technicians,'tasks':tasks,'total':total,'offset':offset,'limit':20,
      'has_more':offset+len(tasks)<total,'status_filter':status,
      'technician_filter':str(technician_id) if technician_id else None}

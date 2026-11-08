"""Append-only machine links and machine report history for the local demo."""
from uuid import UUID
from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from app.fact_reviews import scoped_connection

router=APIRouter(prefix='/api',tags=['Machine history'])
class LinkChange(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    request_id:UUID
    previous_event_id:UUID|None
    machine_id:UUID|None
    reason:str=Field(min_length=1,max_length=1000)

def review_row(conn,org,review_id,lock=False):
    row=conn.execute('SELECT machine_id,created_at FROM sentinel.extraction_reviews WHERE id=%s AND organization_id=%s'+(' FOR UPDATE' if lock else ''),(review_id,org)).fetchone()
    if row is None:raise HTTPException(404,'Fact review not found.')
    return row

def state(conn,org,review_id,initial):
    rows=conn.execute('''SELECT e.id,e.machine_id,e.reason,e.created_at,m.name,m.code
       FROM sentinel.machine_link_events e LEFT JOIN sentinel.machines m
         ON m.id=e.machine_id AND m.organization_id=e.organization_id
       WHERE e.review_id=%s AND e.organization_id=%s ORDER BY e.sequence_number DESC''',(review_id,org)).fetchall()
    original=conn.execute('SELECT name,code FROM sentinel.machines WHERE id=%s AND organization_id=%s',(initial[0],org)).fetchone() if initial[0] else None
    history=[{'event_id':str(r[0]),'machine_id':str(r[1]) if r[1] else None,'reason':r[2],'created_at':r[3].isoformat(),'machine_name':r[4],'machine_code':r[5]} for r in rows]
    baseline={'event_id':None,'machine_id':str(initial[0]) if initial[0] else None,'reason':'Original fact review','created_at':initial[1].isoformat(),'machine_name':original[0] if original else None,'machine_code':original[1] if original else None}
    return {'review_id':str(review_id),'current':history[0] if history else baseline,'history':history+[baseline]}

@router.get('/fact-reviews/{review_id}/machine-link')
def get_link(review_id:UUID,response:Response):
    response.headers['Cache-Control']='no-store'
    with scoped_connection() as (conn,org):
        initial=review_row(conn,org,review_id)
        result=state(conn,org,review_id,initial)
    return result

@router.post('/fact-reviews/{review_id}/machine-link')
def change_link(review_id:UUID,body:LinkChange):
    with scoped_connection() as (conn,org):
        initial=review_row(conn,org,review_id,True)
        prior=conn.execute('SELECT review_id,machine_id,reason FROM sentinel.machine_link_events WHERE id=%s AND organization_id=%s',(body.request_id,org)).fetchone()
        if prior:
            if prior!=(review_id,body.machine_id,body.reason):raise HTTPException(409,'This request identifier was already used for different values.')
        else:
            latest=conn.execute('SELECT id,sequence_number FROM sentinel.machine_link_events WHERE review_id=%s AND organization_id=%s ORDER BY sequence_number DESC LIMIT 1',(review_id,org)).fetchone()
            if (latest[0] if latest else None)!=body.previous_event_id:
                raise HTTPException(409,'The machine link changed. Reload the link before saving another correction.')
            if body.machine_id:
                machine=conn.execute('SELECT id FROM sentinel.machines WHERE id=%s AND organization_id=%s AND active FOR SHARE',(body.machine_id,org)).fetchone()
                if not machine:raise HTTPException(422,'Choose an active machine from this factory or leave it unlinked.')
            conn.execute('''INSERT INTO sentinel.machine_link_events(id,organization_id,review_id,machine_id,reason,sequence_number)
              VALUES (%s,%s,%s,%s,%s,%s)''',(body.request_id,org,review_id,body.machine_id,body.reason,latest[1]+1 if latest else 1))
        result=state(conn,org,review_id,initial)
    return result

@router.get('/machines/{machine_id}/reports')
def machine_reports(machine_id:UUID,response:Response,limit:int=Query(20,ge=1,le=100),offset:int=Query(0,ge=0)):
    response.headers['Cache-Control']='no-store'
    with scoped_connection() as (conn,org):
        machine=conn.execute('SELECT name,code,department FROM sentinel.machines WHERE id=%s AND organization_id=%s',(machine_id,org)).fetchone()
        if not machine:raise HTTPException(404,'Machine not found.')
        rows=conn.execute('''SELECT a.report_id,a.id,a.attempt_number,r.facts,r.created_at,
             CASE WHEN tr.decision='corrected' THEN tr.corrected_transcript ELSE a.original_transcript END
          FROM sentinel.extraction_reviews r
          JOIN sentinel.report_extractions x ON x.id=r.extraction_id AND x.organization_id=r.organization_id
          JOIN sentinel.transcription_attempts a ON a.id=x.attempt_id AND a.organization_id=x.organization_id
          JOIN sentinel.transcription_reviews tr ON tr.attempt_id=a.id AND tr.organization_id=a.organization_id
          LEFT JOIN LATERAL (SELECT id,machine_id FROM sentinel.machine_link_events e
              WHERE e.review_id=r.id AND e.organization_id=r.organization_id ORDER BY sequence_number DESC LIMIT 1) link ON true
          WHERE r.organization_id=%s AND (CASE WHEN link.id IS NOT NULL THEN link.machine_id ELSE r.machine_id END)=%s
          ORDER BY r.created_at DESC,r.id DESC LIMIT %s OFFSET %s''',(org,machine_id,limit+1,offset)).fetchall()
    return {'machine_id':str(machine_id),'name':machine[0],'code':machine[1],'department':machine[2],
      'reports':[{'report_id':str(r[0]),'attempt_id':str(r[1]),'attempt_number':r[2],'facts':r[3],'reviewed_at':r[4].isoformat(),'verified_transcript':r[5]} for r in rows[:limit]],
      'limit':limit,'offset':offset,'has_more':len(rows)>limit}

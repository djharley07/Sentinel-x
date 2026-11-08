"""Manual local-demo escalation tracking with optimistic concurrency and audit."""
from uuid import UUID
from typing import Literal
from fastapi import APIRouter,HTTPException,Response
from pydantic import BaseModel,ConfigDict,Field
from app.fact_reviews import scoped_connection
from app.identity import principal
router=APIRouter(prefix='/api',tags=['REDLINE'])
class Change(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    request_id:UUID
    previous_event_id:UUID|None
    status:Literal['open','acknowledged','resolved']
    note:str=Field(min_length=1,max_length=2000)

def allowed(previous,next_status):
    return next_status in {None:('open',),'open':('acknowledged',),'acknowledged':('resolved',),'resolved':('open',)}.get(previous,())

def source(conn,org,review,lock=False):
    r=conn.execute('SELECT id FROM sentinel.extraction_reviews WHERE id=%s AND organization_id=%s'+(' FOR UPDATE' if lock else ''),(review,org)).fetchone()
    if not r:raise HTTPException(404,'Fact review not found.')

def state(conn,org,review):
    rows=conn.execute('SELECT id,status,note,created_at FROM sentinel.redline_events WHERE review_id=%s AND organization_id=%s ORDER BY sequence_number DESC',(review,org)).fetchall()
    events=[{'event_id':str(r[0]),'status':r[1],'note':r[2],'created_at':r[3].isoformat(),'review_source':'local_demo'} for r in rows]
    return {'review_id':str(review),'current':events[0] if events else None,'history':events,'notification_status':'in_app_only'}

@router.get('/fact-reviews/{review_id}/redline')
def get_redline(review_id:UUID,response:Response):
    response.headers['Cache-Control']='no-store'
    with scoped_connection() as (conn,org):
        source(conn,org,review_id)
        result=state(conn,org,review_id)
    return result

@router.post('/fact-reviews/{review_id}/redline')
def change_redline(review_id:UUID,body:Change):
    with scoped_connection() as (conn,org):
        source(conn,org,review_id,True)
        if principal().role=='worker' and body.status!='open':
            raise HTTPException(403,'Only the owner can acknowledge or resolve an escalation.')
        prior=conn.execute('SELECT review_id,status,note FROM sentinel.redline_events WHERE id=%s AND organization_id=%s',(body.request_id,org)).fetchone()
        if prior:
            if prior!=(review_id,body.status,body.note):raise HTTPException(409,'Request ID already used for different values. Reload REDLINE.')
        else:
            last=conn.execute('SELECT id,status,sequence_number FROM sentinel.redline_events WHERE review_id=%s AND organization_id=%s ORDER BY sequence_number DESC LIMIT 1',(review_id,org)).fetchone()
            if (last[0] if last else None)!=body.previous_event_id:raise HTTPException(409,'REDLINE changed. Reload its current state before updating.')
            if not allowed(last[1] if last else None,body.status):raise HTTPException(409,'Invalid transition. Open, acknowledge, then resolve; resolved cases may be reopened.')
            conn.execute('INSERT INTO sentinel.redline_events(id,organization_id,review_id,sequence_number,status,note) VALUES (%s,%s,%s,%s,%s,%s)',(body.request_id,org,review_id,last[2]+1 if last else 1,body.status,body.note))
        result=state(conn,org,review_id)
    return result

"""Fictional technician assignments and append-only repair progress."""
from uuid import UUID
from typing import Literal
from fastapi import APIRouter,HTTPException,Response
from pydantic import BaseModel,ConfigDict,Field,model_validator
from app.fact_reviews import scoped_connection
from app.identity import principal
from app.access import technician_assignment
router=APIRouter(prefix='/api',tags=['Repair logs'])
class Change(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    request_id:UUID
    previous_event_id:UUID|None
    technician_id:UUID
    status:Literal['assigned','in_progress','completed']
    action_note:str=Field(min_length=1,max_length=4000)
    outcome:Literal['resolved','improved','unresolved','not_checked']|None
    @model_validator(mode='after')
    def check_outcome(self):
        if (self.status=='completed')!=(self.outcome is not None):raise ValueError('Only completed work requires an outcome.')
        return self

def allowed(previous,next_status):
    return next_status in {None:('assigned',),'assigned':('assigned','in_progress'),'in_progress':('assigned','in_progress','completed'),'completed':('assigned',)}.get(previous,())

def source(conn,org,review,lock=False):
    row=conn.execute('SELECT machine_id FROM sentinel.extraction_reviews WHERE id=%s AND organization_id=%s'+(' FOR UPDATE' if lock else ''),(review,org)).fetchone()
    if not row:raise HTTPException(404,'Fact review not found.')
    latest=conn.execute('SELECT machine_id FROM sentinel.machine_link_events WHERE review_id=%s AND organization_id=%s ORDER BY sequence_number DESC LIMIT 1',(review,org)).fetchone()
    return latest[0] if latest is not None else row[0]

def state(conn,org,review):
    rows=conn.execute('''SELECT e.id,e.status,e.action_note,e.outcome,e.created_at,e.technician_id,t.name,e.machine_id,m.name
      FROM sentinel.repair_events e JOIN sentinel.technicians t ON t.id=e.technician_id AND t.organization_id=e.organization_id
      JOIN sentinel.machines m ON m.id=e.machine_id AND m.organization_id=e.organization_id
      WHERE e.review_id=%s AND e.organization_id=%s ORDER BY e.sequence_number DESC''',(review,org)).fetchall()
    events=[{'event_id':str(r[0]),'status':r[1],'action_note':r[2],'outcome':r[3],'created_at':r[4].isoformat(),'technician_id':str(r[5]),'technician_name':r[6],'machine_id':str(r[7]),'machine_name':r[8]} for r in rows]
    techs=conn.execute('SELECT id,code,name FROM sentinel.technicians WHERE organization_id=%s ORDER BY code',(org,)).fetchall()
    user=principal()
    if user.role=='technician':techs=[t for t in techs if t[0]==user.technician_id]
    return {'review_id':str(review),'current':events[0] if events else None,'history':events,
      'technicians':[{'technician_id':str(t[0]),'code':t[1],'name':t[2]} for t in techs],'review_source':'local_demo'}

@router.get('/fact-reviews/{review_id}/repairs')
def get_repairs(review_id:UUID,response:Response):
    response.headers['Cache-Control']='no-store'
    with scoped_connection() as (conn,org):
        source(conn,org,review_id,principal().role=='technician')
        if principal().role=='technician':technician_assignment(conn,review_id)
        result=state(conn,org,review_id)
    return result

@router.post('/fact-reviews/{review_id}/repairs')
def save_repair(review_id:UUID,body:Change):
    with scoped_connection() as (conn,org):
        machine=source(conn,org,review_id,True)
        user=principal()
        if user.role=='technician':
            technician_assignment(conn,review_id)
            if body.technician_id!=user.technician_id or body.status=='assigned':
                raise HTTPException(403,'Only the owner can assign or reassign work.')
        prior=conn.execute('SELECT review_id,technician_id,status,action_note,outcome FROM sentinel.repair_events WHERE id=%s AND organization_id=%s',(body.request_id,org)).fetchone()
        if prior:
            if prior!=(review_id,body.technician_id,body.status,body.action_note,body.outcome):raise HTTPException(409,'Request ID already used for different values. Reload repair log.')
        else:
            last=conn.execute('SELECT id,status,sequence_number,technician_id,machine_id FROM sentinel.repair_events WHERE review_id=%s AND organization_id=%s ORDER BY sequence_number DESC LIMIT 1',(review_id,org)).fetchone()
            if (last[0] if last else None)!=body.previous_event_id:raise HTTPException(409,'Repair log changed. Reload before saving.')
            if not allowed(last[1] if last else None,body.status):raise HTTPException(409,'Assign work, start it, then complete it. Completed work can be reassigned for a new cycle.')
            if not machine:raise HTTPException(409,'Link this report to a machine before recording work.')
            if last and body.status!='assigned' and (last[3]!=body.technician_id or last[4]!=machine):raise HTTPException(409,'Machine or technician changed. Save an assignment first.')
            tech=conn.execute('SELECT id FROM sentinel.technicians WHERE id=%s AND organization_id=%s',(body.technician_id,org)).fetchone()
            if not tech:raise HTTPException(422,'Select a technician from this factory.')
            conn.execute('''INSERT INTO sentinel.repair_events(id,organization_id,review_id,sequence_number,technician_id,machine_id,status,action_note,outcome)
             VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)''',(body.request_id,org,review_id,last[2]+1 if last else 1,body.technician_id,machine,body.status,body.action_note,body.outcome))
        result=state(conn,org,review_id)
    return result

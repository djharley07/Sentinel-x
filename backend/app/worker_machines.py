"""Owner-managed worker staffing, separate from technician repair assignments."""
from uuid import UUID
from fastapi import APIRouter,HTTPException,Query
from pydantic import BaseModel,ConfigDict,Field
from app.database import get_connection
from app.identity import principal

router=APIRouter(prefix='/api',tags=['Worker machines'])
LATEST='''SELECT DISTINCT ON (e.machine_id) e.* FROM sentinel.worker_machine_events e
 WHERE e.organization_id=%s AND e.worker_id=%s ORDER BY e.machine_id,e.sequence_number DESC'''

def worker_row(conn,user,worker_id,lock=False):
    row=conn.execute('SELECT display_name,active FROM sentinel.accounts WHERE id=%s AND organization_id=%s AND role=\'worker\''+(' FOR UPDATE' if lock else ''),(worker_id,user.organization_id)).fetchone()
    if not row:raise HTTPException(404,'Worker account not found in this factory.')
    return row

def can_select_machine(conn,machine_id):
    """Recheck current staffing while the worker row is share-locked until fact save commits."""
    user=principal()
    if user.role!='worker':return
    conn.execute('SELECT id FROM sentinel.accounts WHERE id=%s AND organization_id=%s FOR SHARE',(user.account_id,user.organization_id))
    row=conn.execute('SELECT active FROM sentinel.worker_machine_events WHERE organization_id=%s AND worker_id=%s AND machine_id=%s ORDER BY sequence_number DESC LIMIT 1',(user.organization_id,user.account_id,machine_id)).fetchone()
    if not row or row[0] is not True:
        raise HTTPException(403,'This machine is not currently assigned to you. Refresh the machine list or leave this report unlinked for owner review.')

def state(conn,user,worker_id):
    worker=worker_row(conn,user,worker_id)
    rows=conn.execute('''WITH latest AS ('''+LATEST+''')
       SELECT e.id,e.machine_id,m.code,m.name,m.department,e.active,e.note,e.created_at,a.display_name,m.active AS machine_active
       FROM latest e JOIN sentinel.machines m ON m.id=e.machine_id AND m.organization_id=e.organization_id
       JOIN sentinel.accounts a ON a.id=e.actor_id AND a.organization_id=e.organization_id ORDER BY m.code''',(user.organization_id,worker_id)).fetchall()
    events=conn.execute('''SELECT e.id,m.name,e.active,e.note,e.created_at,a.display_name FROM sentinel.worker_machine_events e
       JOIN sentinel.machines m ON m.id=e.machine_id AND m.organization_id=e.organization_id
       JOIN sentinel.accounts a ON a.id=e.actor_id AND a.organization_id=e.organization_id
       WHERE e.organization_id=%s AND e.worker_id=%s ORDER BY e.created_at DESC,e.id DESC LIMIT 20''',(user.organization_id,worker_id)).fetchall()
    return {'worker_id':str(worker_id),'worker_name':worker[0],'worker_enabled':worker[1],
      'machines':[{'event_id':str(r[0]),'machine_id':str(r[1]),'code':r[2],'name':r[3],'department':r[4],
                   'active':r[5],'note':r[6],'created_at':r[7].isoformat(),'assigned_by':r[8],'machine_active':r[9]} for r in rows],
      'history':[{'event_id':str(r[0]),'machine_name':r[1],'active':r[2],'note':r[3],'created_at':r[4].isoformat(),'actor':r[5]} for r in events]}

@router.get('/worker-machine-options')
def options():
    user=principal()
    if user.role!='owner':raise HTTPException(403,'Owner access is required.')
    with get_connection() as conn:
        workers=conn.execute('SELECT id,username,display_name,active FROM sentinel.accounts WHERE organization_id=%s AND role=\'worker\' ORDER BY username LIMIT 201',(user.organization_id,)).fetchall()
        machines=conn.execute('SELECT id,code,name,department,active FROM sentinel.machines WHERE organization_id=%s ORDER BY code',(user.organization_id,)).fetchall()
    return {'workers':[{'worker_id':str(w[0]),'username':w[1],'name':w[2],'enabled':w[3]} for w in workers[:200]],'workers_truncated':len(workers)>200,
      'machines':[{'machine_id':str(m[0]),'code':m[1],'name':m[2],'department':m[3],'machine_active':m[4]} for m in machines]}

@router.get('/worker-machines')
def get_assignments(worker_id:UUID|None=None):
    user=principal()
    if user.role=='worker':
        if worker_id and worker_id!=user.account_id:raise HTTPException(403,'You can view only your own machine assignments.')
        worker_id=user.account_id
    elif user.role!='owner':raise HTTPException(403,'Worker or owner access is required.')
    if worker_id is None:raise HTTPException(422,'Choose a worker first.')
    with get_connection() as conn:
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        return state(conn,user,worker_id)

class Change(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    request_id:UUID
    previous_event_id:UUID|None
    worker_id:UUID
    machine_id:UUID
    active:bool=Field(strict=True)
    note:str=Field(min_length=1,max_length=2000)

@router.post('/worker-machines')
def change_assignment(body:Change):
    user=principal()
    if user.role!='owner':raise HTTPException(403,'Only the owner can assign machines to workers.')
    with get_connection() as conn:
        worker=worker_row(conn,user,body.worker_id,True)
        prior=conn.execute('SELECT organization_id,actor_id,worker_id,machine_id,active,note FROM sentinel.worker_machine_events WHERE id=%s',(body.request_id,)).fetchone()
        if prior:
            if prior!=(user.organization_id,user.account_id,body.worker_id,body.machine_id,body.active,body.note):raise HTTPException(409,'Request ID already used for different values. Reload assignments.')
        else:
            if body.active and not worker[1]:raise HTTPException(409,'Enable this worker account before assigning a machine.')
            machine=conn.execute('SELECT id FROM sentinel.machines WHERE id=%s AND organization_id=%s'+(' AND active' if body.active else '')+' FOR SHARE',(body.machine_id,user.organization_id)).fetchone()
            if not machine:raise HTTPException(404,'An active machine is required for a new assignment. Refresh the machine list; inactive machines can only have existing assignments removed.')
            last=conn.execute('SELECT id,sequence_number,active FROM sentinel.worker_machine_events WHERE organization_id=%s AND worker_id=%s AND machine_id=%s ORDER BY sequence_number DESC LIMIT 1',(user.organization_id,body.worker_id,body.machine_id)).fetchone()
            if (last[0] if last else None)!=body.previous_event_id:raise HTTPException(409,'Assignment changed. Reload before saving.')
            if (last[2] if last else False)==body.active:raise HTTPException(409,'This machine already has that assignment state. Reload to check it.')
            conn.execute('INSERT INTO sentinel.worker_machine_events(id,organization_id,worker_id,machine_id,actor_id,sequence_number,active,note) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)',
              (body.request_id,user.organization_id,body.worker_id,body.machine_id,user.account_id,last[1]+1 if last else 1,body.active,body.note))
        return state(conn,user,body.worker_id)

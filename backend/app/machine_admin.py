"""Owner-managed machine directory with revision checks and append-only change history."""
from datetime import date
from uuid import UUID,uuid4
import psycopg
from psycopg.types.json import Jsonb
from fastapi import APIRouter,HTTPException,Query
from pydantic import BaseModel,ConfigDict,Field,field_validator,model_validator
from app.database import get_connection
from app.identity import principal

router=APIRouter(prefix='/api/machine-admin',tags=['Machine administration'])
COLUMNS='id,code,name,department,manufacturer,model,last_service_date,active,revision'

def owner():
    user=principal()
    if user.role!='owner':raise HTTPException(403,'Only the factory owner can manage machines.')
    return user

def encode(row):
    return dict(zip(('machine_id','code','name','department','manufacturer','model','last_service_date','active','revision'),
        (str(row[0]),*row[1:6],row[6].isoformat() if row[6] else None,row[7],row[8])))

def machine(conn,org,mid):
    row=conn.execute('SELECT '+COLUMNS+' FROM sentinel.machines WHERE id=%s AND organization_id=%s',(mid,org)).fetchone()
    if not row:raise HTTPException(404,'Machine not found in this factory.')
    return encode(row)

class Change(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    request_id:UUID
    machine_id:UUID|None
    expected_revision:int|None=Field(ge=1,strict=True)
    code:str=Field(min_length=1,max_length=64,pattern=r'^[A-Za-z0-9][A-Za-z0-9._-]*$')
    name:str=Field(min_length=1,max_length=120)
    department:str=Field(min_length=1,max_length=120)
    manufacturer:str=Field(max_length=120)
    model:str=Field(max_length=120)
    last_service_date:date|None
    active:bool=Field(strict=True)
    reason:str=Field(min_length=1,max_length=1000)
    @field_validator('code')
    @classmethod
    def code_upper(cls,value):return value.upper()
    @field_validator('last_service_date')
    @classmethod
    def past_service(cls,value):
        if value and value>date.today():raise ValueError('Last service date cannot be in the future.')
        return value
    @model_validator(mode='after')
    def version_for_edit(self):
        if (self.machine_id is None)!=(self.expected_revision is None):raise ValueError('Choose a machine and its revision for an edit; use neither for a new machine.')
        return self

@router.get('')
def list_machines(status:str=Query('all',pattern='^(all|active|inactive)$'),limit:int=Query(20,ge=1,le=100),offset:int=Query(0,ge=0)):
    u=owner()
    with get_connection() as conn:
        rows=conn.execute('SELECT '+COLUMNS+''' FROM sentinel.machines WHERE organization_id=%s
            AND (%s='all' OR active=(%s='active')) ORDER BY lower(code),id LIMIT %s OFFSET %s''',(u.organization_id,status,status,limit+1,offset)).fetchall()
    return {'machines':[encode(r) for r in rows[:limit]],'has_more':len(rows)>limit,'offset':offset,'limit':limit}

@router.get('/{machine_id}')
def get_machine(machine_id:UUID):
    u=owner()
    with get_connection() as conn:
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        current=machine(conn,u.organization_id,machine_id)
        rows=conn.execute('''SELECT e.id,e.revision,e.reason,e.before_data,e.after_data,e.created_at,a.display_name
          FROM sentinel.machine_admin_events e JOIN sentinel.accounts a ON a.id=e.actor_id AND a.organization_id=e.organization_id
          WHERE e.organization_id=%s AND e.machine_id=%s ORDER BY e.revision DESC LIMIT 20''',(u.organization_id,machine_id)).fetchall()
    return {'machine':current,'history':[{'event_id':str(r[0]),'revision':r[1],'reason':r[2],'before':r[3],'after':r[4],'created_at':r[5].isoformat(),'actor':r[6]} for r in rows]}

@router.post('')
def save_machine(body:Change):
    u=owner();payload=body.model_dump(mode='json')
    try:
        with get_connection() as conn:
            # Serialize administration per factory, including request-ID and code checks.
            org=conn.execute('SELECT id FROM sentinel.organizations WHERE id=%s FOR UPDATE',(u.organization_id,)).fetchone()
            if not org:raise HTTPException(404,'Factory not found.')
            prior=conn.execute('SELECT organization_id,actor_id,machine_id,request_payload FROM sentinel.machine_admin_events WHERE id=%s',(body.request_id,)).fetchone()
            if prior:
                if str(prior[0])!=str(u.organization_id) or str(prior[1])!=str(u.account_id) or prior[3]!=payload:
                    raise HTTPException(409,'This request identifier was already used for different values.')
                return {'machine':machine(conn,u.organization_id,prior[2]),'persistence_status':'saved'}
            before=machine(conn,u.organization_id,body.machine_id) if body.machine_id else None
            if before and before['revision']!=body.expected_revision:
                raise HTTPException(409,'This machine changed since you opened it. Reload its details before editing again.')
            mid=body.machine_id or uuid4();revision=(before['revision']+1) if before else 1
            duplicate=conn.execute('SELECT id FROM sentinel.machines WHERE organization_id=%s AND lower(code)=lower(%s) AND id<>%s',(u.organization_id,body.code,mid)).fetchone()
            if duplicate:raise HTTPException(409,'That machine code is already used in this factory. Choose a different code.')
            values=(body.code,body.name,body.department,body.manufacturer,body.model,body.last_service_date,body.active,revision)
            if before:
                if all(before[k]==payload[k] for k in ('code','name','department','manufacturer','model','last_service_date','active')):
                    raise HTTPException(409,'No machine details changed. Edit a field before saving.')
                conn.execute('''UPDATE sentinel.machines SET code=%s,name=%s,department=%s,manufacturer=%s,model=%s,
                    last_service_date=%s,active=%s,revision=%s WHERE id=%s AND organization_id=%s''',(*values,mid,u.organization_id))
            else:
                conn.execute('''INSERT INTO sentinel.machines(code,name,department,manufacturer,model,last_service_date,active,revision,id,organization_id)
                    VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',(*values,mid,u.organization_id))
            after=machine(conn,u.organization_id,mid)
            conn.execute('''INSERT INTO sentinel.machine_admin_events(id,organization_id,machine_id,actor_id,revision,request_payload,before_data,after_data,reason)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)''',(body.request_id,u.organization_id,mid,u.account_id,revision,Jsonb(payload),Jsonb(before) if before else None,Jsonb(after),body.reason))
            return {'machine':after,'persistence_status':'saved'}
    except psycopg.errors.UniqueViolation:
        raise HTTPException(409,'That machine code or request identifier is already used. Reload before trying again.') from None

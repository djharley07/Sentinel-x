"""Owner-only local account administration. Never returns passwords or hashes."""
from contextlib import contextmanager
from typing import Literal
from uuid import UUID, uuid4
import psycopg
from psycopg.types.json import Jsonb
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from app.database import get_connection
from app.identity import principal
from app.accounts import hash_password

router = APIRouter(prefix='/api/account-admin', tags=['Owner account management'])

def require_owner():
    user = principal()
    if user.role != 'owner':
        raise HTTPException(403, 'Only the factory owner can manage accounts.')
    return user

@contextmanager
def admin_connection(write=False):
    user = require_owner()
    try:
        with get_connection() as conn:
            if write:
                # Serialize owner commands for the same factory, including repeated request IDs.
                conn.execute('SELECT id FROM sentinel.organizations WHERE id=%s FOR UPDATE', (user.organization_id,))
                row = conn.execute('SELECT role,active FROM sentinel.accounts WHERE id=%s AND organization_id=%s FOR SHARE', (user.account_id,user.organization_id)).fetchone()
                if not row or row != ('owner',True):
                    raise HTTPException(403, 'Owner access is no longer active.')
            yield conn, user
    except psycopg.errors.UniqueViolation:
        raise HTTPException(409, 'That username or technician is already linked. Refresh the account list.') from None
    except psycopg.Error:
        raise HTTPException(503, 'Could not manage accounts. Check migration 009 and retry the same action.') from None

def account(row):
    return dict(zip(('account_id','username','display_name','role','active','technician_id','technician_code'),
                    (str(row[0]),row[1],row[2],row[3],row[4],str(row[5]) if row[5] else None,row[6])))

ACCOUNT_SQL = '''SELECT a.id,a.username,a.display_name,a.role,a.active,a.technician_id,t.code
 FROM sentinel.accounts a LEFT JOIN sentinel.technicians t ON t.id=a.technician_id AND t.organization_id=a.organization_id'''

def load_account(conn,org,target):
    row=conn.execute(ACCOUNT_SQL+' WHERE a.organization_id=%s AND a.id=%s',(org,target)).fetchone()
    if not row:raise HTTPException(404,'Account not found.')
    return account(row)

def prior_result(conn,user,request_id,action,data):
    row=conn.execute('SELECT organization_id,actor_id,target_id,action,request_data FROM sentinel.account_admin_events WHERE request_id=%s',(request_id,)).fetchone()
    if row:
        if row[0]!=user.organization_id or row[1]!=user.account_id or row[3]!=action or row[4]!=data:
            raise HTTPException(409,'This request ID was used for another action. Refresh before continuing.')
        return {'action':action,'request_id':str(request_id),'account':load_account(conn,user.organization_id,row[2]),'already_applied':True}

def record_result(conn,user,request_id,target,action,data):
    # request_data contains only public metadata. Passwords and their hashes are excluded.
    conn.execute('INSERT INTO sentinel.account_admin_events(request_id,organization_id,actor_id,target_id,action,request_data) VALUES(%s,%s,%s,%s,%s,%s)',
                 (request_id,user.organization_id,user.account_id,target,action,Jsonb(data)))
    return {'action':action,'request_id':str(request_id),'account':load_account(conn,user.organization_id,target),'already_applied':False}

class Create(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_id:UUID
    username:str=Field(pattern=r'^[a-z0-9][a-z0-9_.-]{2,63}$')
    display_name:str=Field(min_length=1,max_length=100)
    role:Literal['worker','technician']
    password:str=Field(min_length=12,max_length=256)
    technician_id:UUID|None=None
    @field_validator('username',mode='before')
    @classmethod
    def username_clean(cls,v):return v.strip().lower() if isinstance(v,str) else v
    @field_validator('display_name',mode='before')
    @classmethod
    def name_clean(cls,v):return v.strip() if isinstance(v,str) else v
    @model_validator(mode='after')
    def technician_role(self):
        if self.role=='worker' and self.technician_id is not None:raise ValueError('Workers cannot be linked to technicians.')
        return self

class Reset(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_id:UUID
    password:str=Field(min_length=12,max_length=256)

class Active(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_id:UUID
    active:bool=Field(strict=True)

@router.get('')
def list_accounts(offset:int=Query(0,ge=0)):
    with admin_connection() as (conn,user):
        org=user.organization_id
        # One repeatable snapshot keeps pagination counts and rows coherent.
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        total=conn.execute('SELECT count(*) FROM sentinel.accounts WHERE organization_id=%s',(org,)).fetchone()[0]
        rows=conn.execute(ACCOUNT_SQL+' WHERE a.organization_id=%s ORDER BY a.username LIMIT 20 OFFSET %s',(org,offset)).fetchall()
        techs=conn.execute('''SELECT t.id,t.code,t.name FROM sentinel.technicians t WHERE t.organization_id=%s
          AND NOT EXISTS(SELECT 1 FROM sentinel.accounts a WHERE a.technician_id=t.id) ORDER BY t.code''',(org,)).fetchall()
        events=conn.execute('''SELECT e.request_id,e.action,e.created_at,a.username,t.username FROM sentinel.account_admin_events e
          JOIN sentinel.accounts a ON a.id=e.actor_id AND a.organization_id=e.organization_id
          JOIN sentinel.accounts t ON t.id=e.target_id AND t.organization_id=e.organization_id
          WHERE e.organization_id=%s ORDER BY e.created_at DESC,e.request_id DESC LIMIT 20''',(org,)).fetchall()
    return {'accounts':[account(r) for r in rows],'total':total,'offset':offset,'limit':20,'has_more':offset+len(rows)<total,
            'available_technicians':[{'technician_id':str(t[0]),'code':t[1],'name':t[2]} for t in techs],
            'recent_actions':[{'request_id':str(r[0]),'action':r[1],'created_at':r[2].isoformat(),'actor':r[3],'target':r[4]} for r in events]}

@router.post('')
def create_account(body:Create):
    with admin_connection(True) as (conn,user):
        data=body.model_dump(mode='json',exclude={'password','request_id'})
        prior=prior_result(conn,user,body.request_id,'created',data)
        if prior:return prior
        tech=body.technician_id
        if body.role=='technician':
            if tech:
                found=conn.execute('SELECT id FROM sentinel.technicians WHERE id=%s AND organization_id=%s FOR UPDATE',(tech,user.organization_id)).fetchone()
                if not found:raise HTTPException(404,'Technician record not found in this factory.')
            else:
                tech=uuid4()
                conn.execute('INSERT INTO sentinel.technicians(id,organization_id,code,name) VALUES(%s,%s,%s,%s)',(tech,user.organization_id,'TECH-'+tech.hex[:12].upper(),body.display_name))
        target=uuid4()
        conn.execute('INSERT INTO sentinel.accounts(id,organization_id,username,display_name,password_hash,role,technician_id) VALUES(%s,%s,%s,%s,%s,%s,%s)',
                     (target,user.organization_id,body.username,body.display_name,hash_password(body.password),body.role,tech))
        return record_result(conn,user,body.request_id,target,'created',data)

def editable_account(conn,user,target):
    row=conn.execute('SELECT role FROM sentinel.accounts WHERE id=%s AND organization_id=%s FOR UPDATE',(target,user.organization_id)).fetchone()
    if not row:raise HTTPException(404,'Account not found.')
    if target==user.account_id or row[0]=='owner':
        raise HTTPException(403,'Owner accounts are protected. Use the local administrator console for owner recovery.')

@router.post('/{account_id}/password')
def reset_password(account_id:UUID,body:Reset):
    with admin_connection(True) as (conn,user):
        data={'account_id':str(account_id)}
        prior=prior_result(conn,user,body.request_id,'password_reset',data)
        if prior:return prior
        editable_account(conn,user,account_id)
        conn.execute('UPDATE sentinel.accounts SET password_hash=%s WHERE id=%s AND organization_id=%s',(hash_password(body.password),account_id,user.organization_id))
        conn.execute('DELETE FROM sentinel.sessions WHERE account_id=%s',(account_id,))
        return record_result(conn,user,body.request_id,account_id,'password_reset',data)

@router.post('/{account_id}/active')
def set_active(account_id:UUID,body:Active):
    with admin_connection(True) as (conn,user):
        data={'account_id':str(account_id),'active':body.active};action='enabled' if body.active else 'disabled'
        prior=prior_result(conn,user,body.request_id,action,data)
        if prior:return prior
        editable_account(conn,user,account_id)
        conn.execute('UPDATE sentinel.accounts SET active=%s WHERE id=%s AND organization_id=%s',(body.active,account_id,user.organization_id))
        conn.execute('DELETE FROM sentinel.sessions WHERE account_id=%s',(account_id,))
        return record_result(conn,user,body.request_id,account_id,action,data)

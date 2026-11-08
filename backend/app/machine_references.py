"""Version-labelled text documents, explicitly reviewed by owner before use in chat."""
import hashlib,json
from typing import Literal
from uuid import UUID
from fastapi import APIRouter,HTTPException
from pydantic import BaseModel,ConfigDict,Field,field_validator
from psycopg.types.json import Jsonb
from app.database import get_connection
from app.identity import principal

router=APIRouter(prefix='/api/machine-references',tags=['Machine reference documents'])
FIELDS='id,title,document_version,kind,manufacturer,model,content,content_sha256,available,revision,created_at'

def owner():
    u=principal()
    if u.role!='owner':raise HTTPException(403,'Only the factory owner can manage reference documents.')
    return u

def visible_rows(conn,include_inactive=False):
    u=principal();params=[u.organization_id]
    if u.role=='owner':scope='true'
    elif u.role=='worker':
        scope='''EXISTS (SELECT 1 FROM (SELECT DISTINCT ON(machine_id) machine_id,active
          FROM sentinel.worker_machine_events WHERE organization_id=%s AND worker_id=%s
          ORDER BY machine_id,sequence_number DESC) e WHERE e.machine_id=m.id AND e.active)'''
        params.extend([u.organization_id,u.account_id])
    elif u.role=='technician':
        scope='''EXISTS (SELECT 1 FROM (SELECT DISTINCT ON(review_id) machine_id,technician_id
          FROM sentinel.repair_events WHERE organization_id=%s ORDER BY review_id,sequence_number DESC) e
          WHERE e.machine_id=m.id AND e.technician_id=%s)'''
        params.extend([u.organization_id,u.technician_id])
    else:raise HTTPException(403,'Factory account access is required.')
    active='true' if include_inactive and u.role=='owner' else 'm.active'
    return conn.execute('SELECT m.id,m.code,m.name,m.manufacturer,m.model,m.revision,m.active FROM sentinel.machines m WHERE m.organization_id=%s AND '+active+' AND '+scope+' ORDER BY m.code',params).fetchall()

def selected(conn,mid):
    row=next((r for r in visible_rows(conn) if str(r[0])==str(mid)),None)
    if not row:raise HTTPException(404,'This active machine is not available to your account. Refresh the machine list.')
    return row

def matching(row,m):return row[4]==m[3] and row[5]==m[4]
def encode(row,m):
    return dict(zip(('document_id','title','document_version','kind','manufacturer','model','content','content_sha256','available','revision','created_at','matches_machine'),
        (str(row[0]),*row[1:10],row[10].isoformat(),matching(row,m))))

@router.get('/machines')
def machines():
    with get_connection() as conn:
        rows=visible_rows(conn,True)
    return {'machines':[{'machine_id':str(r[0]),'code':r[1],'name':r[2],'manufacturer':r[3],'model':r[4],'revision':r[5],'active':r[6]} for r in rows]}

class NewDocument(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    request_id:UUID
    machine_id:UUID
    expected_machine_revision:int=Field(ge=1,strict=True)
    title:str=Field(min_length=1,max_length=120)
    document_version:str=Field(min_length=1,max_length=60)
    kind:Literal['fictional_reference','owner_reference']
    content:str=Field(min_length=1,max_length=8000)
    @field_validator('content')
    @classmethod
    def plain_text(cls,value):
        if any(ord(c)<32 and c not in '\n\r\t' for c in value):raise ValueError('Use plain text without control characters.')
        return value.replace('\r\n','\n')

@router.get('/{machine_id}')
def documents(machine_id:UUID):
    owner()
    with get_connection() as conn:
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        # Inactive records remain reviewable by the owner, even though chat cannot use them.
        u=principal();m=conn.execute('SELECT id,code,name,manufacturer,model,revision FROM sentinel.machines WHERE id=%s AND organization_id=%s',(machine_id,u.organization_id)).fetchone()
        if not m:raise HTTPException(404,'Machine not found.')
        rows=conn.execute('SELECT '+FIELDS+' FROM sentinel.machine_reference_documents WHERE organization_id=%s AND machine_id=%s ORDER BY created_at DESC,id DESC LIMIT 101',(u.organization_id,machine_id)).fetchall()
        events=conn.execute('''SELECT e.id,e.document_id,e.revision,e.available,e.reason,e.created_at,a.display_name
          FROM sentinel.machine_reference_events e JOIN sentinel.accounts a ON a.id=e.actor_id AND a.organization_id=e.organization_id
          WHERE e.organization_id=%s AND e.document_id IN (SELECT id FROM sentinel.machine_reference_documents WHERE organization_id=%s AND machine_id=%s)
          ORDER BY e.created_at DESC,e.id DESC LIMIT 20''',(u.organization_id,u.organization_id,machine_id)).fetchall()
    return {'documents':[encode(r,m) for r in rows[:100]],'truncated':len(rows)>100,'history':[{'event_id':str(r[0]),'document_id':str(r[1]),'revision':r[2],'available':r[3],'reason':r[4],'created_at':r[5].isoformat(),'actor':r[6]} for r in events]}

@router.post('')
def create_document(body:NewDocument):
    u=owner();payload=body.model_dump(mode='json')
    with get_connection() as conn:
        conn.execute('SELECT id FROM sentinel.organizations WHERE id=%s FOR UPDATE',(u.organization_id,))
        prior=conn.execute('SELECT organization_id,actor_id,create_payload FROM sentinel.machine_reference_documents WHERE id=%s',(body.request_id,)).fetchone()
        if prior:
            if str(prior[0])!=str(u.organization_id) or str(prior[1])!=str(u.account_id) or prior[2]!=payload:raise HTTPException(409,'Request identifier already used for different values.')
        else:
            m=selected(conn,body.machine_id)
            if m[5]!=body.expected_machine_revision:raise HTTPException(409,'Machine details changed. Reload the machine before attaching a document.')
            count=conn.execute('SELECT count(*) FROM sentinel.machine_reference_documents WHERE organization_id=%s AND machine_id=%s',(u.organization_id,body.machine_id)).fetchone()[0]
            if count>=100:raise HTTPException(409,'This demo supports up to 100 document versions per machine.')
            digest=hashlib.sha256(body.content.encode()).hexdigest()
            conn.execute('''INSERT INTO sentinel.machine_reference_documents(id,organization_id,machine_id,actor_id,title,document_version,kind,manufacturer,model,content,content_sha256,create_payload)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',(body.request_id,u.organization_id,body.machine_id,u.account_id,body.title,body.document_version,body.kind,m[3],m[4],body.content,digest,Jsonb(payload)))
            conn.execute('''INSERT INTO sentinel.machine_reference_events(id,organization_id,document_id,actor_id,revision,available,reason,request_payload)
                VALUES(%s,%s,%s,%s,1,false,'Document saved for owner review',%s)''',(body.request_id,u.organization_id,body.request_id,u.account_id,Jsonb(payload)))
    return {'document_id':str(body.request_id),'persistence_status':'saved'}

class Availability(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    request_id:UUID
    document_id:UUID
    expected_revision:int=Field(ge=1,strict=True)
    available:bool=Field(strict=True)
    reviewed:bool=Field(strict=True)
    reason:str=Field(min_length=1,max_length=1000)

@router.post('/availability')
def availability(body:Availability):
    u=owner();payload=body.model_dump(mode='json')
    with get_connection() as conn:
        conn.execute('SELECT id FROM sentinel.organizations WHERE id=%s FOR UPDATE',(u.organization_id,))
        prior=conn.execute('SELECT organization_id,actor_id,request_payload FROM sentinel.machine_reference_events WHERE id=%s',(body.request_id,)).fetchone()
        if prior:
            if str(prior[0])!=str(u.organization_id) or str(prior[1])!=str(u.account_id) or prior[2]!=payload:raise HTTPException(409,'Request identifier already used for different values.')
        else:
            row=conn.execute('SELECT '+FIELDS+',machine_id FROM sentinel.machine_reference_documents WHERE id=%s AND organization_id=%s FOR UPDATE',(body.document_id,u.organization_id)).fetchone()
            if not row:raise HTTPException(404,'Document not found.')
            if row[9]!=body.expected_revision:raise HTTPException(409,'Document status changed. Reload documents before trying again.')
            if row[8]==body.available:raise HTTPException(409,'Document already has that availability. Reload to check it.')
            if body.available:
                if not body.reviewed:raise HTTPException(422,'Review the full document and confirm its machine/model match before enabling it.')
                m=selected(conn,row[11])
                if row[3]=='owner_reference' and (not m[3].strip() or not m[4].strip()):raise HTTPException(409,'Record this machine manufacturer and exact model before enabling an owner-supplied reference.')
                if not matching(row,m):raise HTTPException(409,'Machine manufacturer or model changed. Attach a freshly checked document version.')
                count=conn.execute('SELECT count(*) FROM sentinel.machine_reference_documents WHERE organization_id=%s AND machine_id=%s AND available',(u.organization_id,row[11])).fetchone()[0]
                if count>=2:raise HTTPException(409,'Keep at most two reference versions available per machine. Withdraw an older version first.')
            revision=row[9]+1
            conn.execute('UPDATE sentinel.machine_reference_documents SET available=%s,revision=%s WHERE id=%s AND organization_id=%s',(body.available,revision,body.document_id,u.organization_id))
            conn.execute('''INSERT INTO sentinel.machine_reference_events(id,organization_id,document_id,actor_id,revision,available,reason,request_payload)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s)''',(body.request_id,u.organization_id,body.document_id,u.account_id,revision,body.available,body.reason,Jsonb(payload)))
    return {'document_id':str(body.document_id),'persistence_status':'saved'}

def scoped_sources(machine_id):
    """Only selected, currently authorized machine and matching owner-enabled versions."""
    u=principal()
    with get_connection() as conn:
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        m=selected(conn,machine_id)
        docs=conn.execute('SELECT '+FIELDS+' FROM sentinel.machine_reference_documents WHERE organization_id=%s AND machine_id=%s AND available ORDER BY id',(u.organization_id,machine_id)).fetchall()
    sources=[];fingerprint=[str(machine_id),m[1],m[2],m[3],m[4],m[5]]
    for row in docs:
        if not matching(row,m):continue
        fingerprint.append([str(row[0]),row[9],row[7]])
        # Stable text passages; preserve every character rather than summarize or invent extraction.
        text=row[6];parts=[]
        while len(text)>1800:
            cut=max(text.rfind('\n',0,1801),text.rfind('. ',0,1801)+1,text.rfind(' ',0,1801))
            if cut<900:cut=1800
            parts.append(text[:cut]);text=text[cut:]
        if text:parts.append(text)
        label='Fictional demo reference' if row[3]=='fictional_reference' else 'Owner-supplied reference; authenticity not independently verified'
        for i,part in enumerate(parts,1):
            sources.append({'id':f'doc-{row[0]}-{i}','title':f'{row[1]} · version {row[2]} · {m[1]} / {m[4] or "model not recorded"} · passage {i}',
                'text':label+'. '+part,'kind':row[3]})
    return hashlib.sha256(json.dumps(fingerprint,ensure_ascii=False).encode()).hexdigest()[:20],sources

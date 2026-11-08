"""Immutable human review of AI facts, scoped to the configured demo factory."""
from contextlib import contextmanager
from uuid import UUID
import logging
import psycopg
from psycopg.types.json import Jsonb
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ConfigDict, model_validator
from app.database import get_connection, get_demo_organization_id
from app.extraction import ExtractedFacts, reviewed_source
from app.identity import principal
from app.equipment_check import require_latest
from app.worker_machines import LATEST as STAFFING_LATEST, can_select_machine

router = APIRouter(prefix='/api', tags=['Fact reviews'])
logger = logging.getLogger(__name__)

class FactReview(BaseModel):
    model_config = ConfigDict(extra='forbid')
    facts: ExtractedFacts
    machine_id: UUID | None

    @model_validator(mode='after')
    def coherent_temperature(self):
        if self.facts.temperature_value is None and self.facts.temperature_unit is not None:
            raise ValueError('A temperature unit requires a temperature value.')
        return self

@contextmanager
def scoped_connection():
    try:
        org = get_demo_organization_id()
        with get_connection() as conn:
            row = conn.execute('SELECT is_demo FROM sentinel.organizations WHERE id=%s FOR SHARE',(org,)).fetchone()
            if row is None or row[0] is not True:
                raise HTTPException(503,'A valid demo organization is required.')
            yield conn,org
    except (psycopg.Error,OSError,RuntimeError,ValueError) as error:
        logger.error('Fact review database error: %s',type(error).__name__)
        raise HTTPException(503,'Could not confirm fact review state. Check saved review before retrying; ensure migration 003 is installed.') from None

def encode(row):
    if row is None: return None
    return {'review_id':str(row[0]),'facts':row[1], 'machine_id':str(row[2]) if row[2] else None,
            'created_at':row[3].isoformat(),'review_source':'local_demo','persistence_status':'saved'}

def existing(conn,org,extraction):
    return conn.execute('SELECT id,facts,machine_id,created_at FROM sentinel.extraction_reviews WHERE extraction_id=%s AND organization_id=%s',(extraction,org)).fetchone()

@router.get('/machines')
def machines(response: Response):
    response.headers['Cache-Control']='no-store'
    with scoped_connection() as (conn,org):
        user=principal()
        if user.role=='worker':
            rows=conn.execute('WITH latest AS ('+STAFFING_LATEST+') SELECT m.id,m.code,m.name,m.department FROM latest e JOIN sentinel.machines m ON m.id=e.machine_id AND m.organization_id=e.organization_id WHERE e.active AND m.active ORDER BY m.code',(org,user.account_id)).fetchall()
        else:
            rows=conn.execute('SELECT id,code,name,department FROM sentinel.machines WHERE organization_id=%s AND active ORDER BY code',(org,)).fetchall()
    return {'machines':[dict(zip(('machine_id','code','name','department'),(str(r[0]),*r[1:]))) for r in rows]}

@router.get('/extractions/{extraction_id}/review')
def get_review(extraction_id:UUID,response:Response):
    response.headers['Cache-Control']='no-store'
    with scoped_connection() as (conn,org):
        found=conn.execute('SELECT id FROM sentinel.report_extractions WHERE id=%s AND organization_id=%s',(extraction_id,org)).fetchone()
        if not found: raise HTTPException(404,'Extraction not found.')
        review=encode(existing(conn,org,extraction_id))
    return {'extraction_id':str(extraction_id),'review':review}

@router.post('/extractions/{extraction_id}/review')
def save_review(extraction_id:UUID,body:FactReview):
    # Resolve source before taking a write lock. Accepted/corrected reviews are immutable.
    with scoped_connection() as (conn,org):
        found=conn.execute('SELECT attempt_id FROM sentinel.report_extractions WHERE id=%s AND organization_id=%s',(extraction_id,org)).fetchone()
        if not found: raise HTTPException(404,'Extraction not found.')
        attempt_id=found[0]
    reviewed_source(attempt_id)
    facts=body.facts.model_dump()
    with scoped_connection() as (conn,org):
        require_latest(conn,attempt_id,lock=True)
        found=conn.execute('SELECT id FROM sentinel.report_extractions WHERE id=%s AND organization_id=%s FOR UPDATE',(extraction_id,org)).fetchone()
        if not found: raise HTTPException(404,'Extraction not found.')
        prior=existing(conn,org,extraction_id)
        if prior:
            if prior[1]!=facts or prior[2]!=body.machine_id:
                raise HTTPException(409,'A different fact review is already saved. Reload it; this milestone preserves reviews unchanged.')
            result=encode(prior)
        else:
            if body.machine_id is not None:
                can_select_machine(conn,body.machine_id)
                machine=conn.execute('SELECT id FROM sentinel.machines WHERE id=%s AND organization_id=%s AND active FOR SHARE',(body.machine_id,org)).fetchone()
                if not machine: raise HTTPException(422,'Select an active machine from this factory or leave it unlinked.')
            row=conn.execute('''INSERT INTO sentinel.extraction_reviews(organization_id,extraction_id,machine_id,facts)
                VALUES (%s,%s,%s,%s) RETURNING id,facts,machine_id,created_at''',(org,extraction_id,body.machine_id,Jsonb(facts))).fetchone()
            result=encode(row)
    return {'extraction_id':str(extraction_id),'review':result}

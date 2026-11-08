"""Append a corrected report version; preserve the original recording and all history."""
from uuid import UUID,uuid4
from fastapi import APIRouter,HTTPException
from pydantic import BaseModel,ConfigDict,Field
from app.database import get_connection
from app.identity import principal
from app.access import require_owned
from app.equipment_check import require_latest,equipment_warnings,available_machines
router=APIRouter(prefix='/api/attempts',tags=['Later transcript corrections'])
class Correction(BaseModel):
    model_config=ConfigDict(extra='forbid')
    request_id:UUID
    text:str=Field(min_length=1,max_length=20000)
    reason:str=Field(min_length=1,max_length=2000)
    equipment_check_acknowledged:bool=False

@router.post('/{attempt_id}/corrections')
def correct_saved_transcript(attempt_id:UUID,body:Correction):
    u=principal()
    if u.role not in ('owner','worker'):raise HTTPException(403,'Owner or submitting worker access is required.')
    text=body.text.strip();reason=body.reason.strip()
    if not text or not reason:raise HTTPException(422,'Enter corrected text and a reason.')
    with get_connection() as conn:
        require_owned(conn,'attempt',attempt_id)
        source=conn.execute('''SELECT a.report_id,a.attempt_number,a.original_transcript,a.model,
             a.detected_language_code,a.provider_request_id,a.audio_storage_key,v.decision,v.corrected_transcript
             FROM sentinel.transcription_attempts a LEFT JOIN sentinel.transcription_reviews v
             ON v.attempt_id=a.id AND v.organization_id=a.organization_id WHERE a.id=%s AND a.organization_id=%s''',(attempt_id,u.organization_id)).fetchone()
        # Same lock as replacement recordings; serialize version writers before idempotency/latest checks.
        conn.execute('SELECT id FROM sentinel.reports WHERE id=%s AND organization_id=%s FOR UPDATE',(source[0],u.organization_id)).fetchone()
        prior=conn.execute('''SELECT c.organization_id,c.source_attempt_id,c.actor_id,c.reason,c.new_attempt_id,v.corrected_transcript
             FROM sentinel.transcript_corrections c JOIN sentinel.transcription_reviews v ON v.attempt_id=c.new_attempt_id
             WHERE c.request_id=%s''',(body.request_id,)).fetchone()
        if prior:
            if tuple(map(str,prior[:3]))!=(str(u.organization_id),str(attempt_id),str(u.account_id)) or prior[3]!=reason or prior[5]!=text:
                raise HTTPException(409,'This correction request was already used. Refresh the report before trying another correction.')
            return {'report_id':str(source[0]),'attempt_id':str(prior[4]),'persistence_status':'saved'}
        require_latest(conn,attempt_id)
        if source[7] not in ('accepted','corrected'):raise HTTPException(409,'Only a saved accepted or corrected transcript can receive a later correction.')
        previous=source[8] if source[7]=='corrected' else source[2]
        if text==previous:raise HTTPException(422,'The text is unchanged. Edit the transcript before saving a new version.')
        if equipment_warnings(text,available_machines(conn)) and not body.equipment_check_acknowledged:
            raise HTTPException(422,'Check the possible equipment-name mismatch before saving.')
        org=conn.execute('SELECT is_demo FROM sentinel.organizations WHERE id=%s FOR SHARE',(u.organization_id,)).fetchone()
        if not org or org[0] is not True:raise HTTPException(503,'A valid demo factory is required.')
        new_id=uuid4()
        conn.execute('''INSERT INTO sentinel.transcription_attempts(id,organization_id,report_id,attempt_number,
          original_transcript,model,detected_language_code,provider_request_id,audio_storage_key)
          VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)''',(new_id,u.organization_id,source[0],source[1]+1,*source[2:7]))
        conn.execute("INSERT INTO sentinel.transcription_reviews(organization_id,attempt_id,decision,corrected_transcript,review_source) VALUES(%s,%s,'corrected',%s,'local_demo')",(u.organization_id,new_id,text))
        conn.execute('''INSERT INTO sentinel.transcript_corrections(request_id,organization_id,source_attempt_id,new_attempt_id,actor_id,reason)
          VALUES(%s,%s,%s,%s,%s,%s)''',(body.request_id,u.organization_id,attempt_id,new_id,u.account_id,reason))
        result={'report_id':str(source[0]),'attempt_id':str(new_id),'persistence_status':'saved'}
    return result

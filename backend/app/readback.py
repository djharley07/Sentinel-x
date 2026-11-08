"""WAV synthesis for report read-back, draft previews and verified chat answers."""
import io
import wave
import struct
from typing import Literal
from uuid import UUID
import requests
from fastapi import APIRouter,HTTPException,Response
from pydantic import BaseModel,ConfigDict,Field
from app.equipment_check import require_latest
from app.database import get_connection,read_database_settings
from app.identity import principal
from app.access import require_owned
from app.extraction import reviewed_source

router=APIRouter(prefix='/api/attempts',tags=['Reviewed report read-back'])
MAX_AUDIO=12*1024*1024
class Readback(BaseModel):
    model_config=ConfigDict(extra='forbid')
    language:Literal['auto','en-IN','hi-IN','bn-IN','hi-en','ta-IN','te-IN','kn-IN','ml-IN','mr-IN','pa-IN','gu-IN']='auto'

def validate_wav(raw):
    if not raw or len(raw)>MAX_AUDIO:raise HTTPException(502,'Gnani returned empty or oversized audio.')
    try:
        # Gnani can return streaming WAV headers with 0xffffffff sizes even on
        # the synchronous endpoint. Only that explicit sentinel is repaired;
        # finite lengths still have to match the complete received response.
        if raw[:4]!=b'RIFF' or raw[8:12]!=b'WAVE' or len(raw)<12:
            raise ValueError('Not RIFF/WAVE')
        riff_size=struct.unpack_from('<I',raw,4)[0]
        if riff_size!=0xffffffff and riff_size+8!=len(raw):
            raise ValueError('Incorrect RIFF length')
        offset=12;found_format=False;found_data=False
        repaired=bytearray(raw)
        while offset+8<=len(raw):
            tag=raw[offset:offset+4];size=struct.unpack_from('<I',raw,offset+4)[0]
            start=offset+8
            if tag==b'data':
                if not found_format or found_data:raise ValueError('Invalid chunk order')
                found_data=True
                if size==0xffffffff:
                    size=len(raw)-start
                    if size%2:raise ValueError('Incomplete PCM sample')
                    struct.pack_into('<I',repaired,offset+4,size)
                if size%2 or start+size!=len(raw):raise ValueError('Incorrect audio length')
                break
            if start+size>len(raw):raise ValueError('Truncated chunk')
            if tag==b'fmt ':
                if found_format or size<16:raise ValueError('Invalid format chunk')
                found_format=True
                fmt=struct.unpack_from('<HHIIHH',raw,start)
                if fmt!=(1,1,24000,48000,2,16):raise ValueError('Unexpected PCM format')
            offset=start+size+(size%2)
        if not found_data:raise ValueError('Missing audio')
        struct.pack_into('<I',repaired,4,len(raw)-8)
        raw=bytes(repaired)
        with wave.open(io.BytesIO(raw),'rb') as w:
            frames=w.getnframes()
            if w.getnchannels()!=1 or w.getsampwidth()!=2 or w.getframerate()!=24000 or w.getcomptype()!='NONE' or not 0<frames<=24000*300:
                raise ValueError('Unexpected audio format')
            if len(w.readframes(frames))!=frames*2:raise ValueError('Truncated audio')
        return raw
    except (wave.Error,EOFError,ValueError):
        raise HTTPException(502,'Gnani did not return valid WAV audio.') from None

@router.post('/{attempt_id}/readback')
def generate_readback(attempt_id:UUID,body:Readback):
    user=principal()
    if user.role not in ('owner','worker'):raise HTTPException(403,'Report read-back is available to owners and the report submitter.')
    with get_connection() as conn:require_owned(conn,'attempt',attempt_id)
    source=reviewed_source(attempt_id)
    text=source['verified_transcript']
    return synthesize(text,body.language)

class PreviewReadback(Readback):
    text:str=Field(min_length=1,max_length=1500)

@router.post('/{attempt_id}/preview-readback')
def preview_readback(attempt_id:UUID,body:PreviewReadback):
    if principal().role not in ('owner','worker'):raise HTTPException(403,'Owner or submitting worker access is required.')
    with get_connection() as conn:require_latest(conn,attempt_id)
    return synthesize(body.text,body.language)

def synthesize(text,language,*,max_chars=1500):
    if len(text)>max_chars:raise HTTPException(413,f'Read-back supports up to {max_chars:,} characters for this request.')
    if '<' in text or '>' in text:raise HTTPException(422,'Read-back currently does not accept markup or angle-bracket symbols. The saved report is unchanged.')
    settings=read_database_settings()
    key=settings.get('GNANI_TTS_API_KEY') or settings.get('GNANI_API_KEY')
    if not key:raise HTTPException(503,'Configure a Gnani key with text-to-speech access on the backend.')
    try:
        with requests.post('https://api.vachana.ai/api/v1/tts/inference',
          headers={'X-API-Key-ID':key,'Content-Type':'application/json'},
          json={'text':text,'model':'timbre-v3.0','voice':'Shivani','language':language,'speed':1.0,
                'audio_config':{'sample_rate':24000,'num_channels':1,'sample_width':2,'encoding':'linear_pcm','container':'wav'}},
          timeout=(10,60),allow_redirects=False,stream=True) as result:
            if result.status_code in (401,402,403):raise HTTPException(502,'Gnani TTS access was denied. Check the backend key’s TTS access and credits; do not share the key.')
            if result.status_code==429:raise HTTPException(429,'Gnani is busy or rate-limited. Wait for any transcription to finish, then try once more.')
            if result.status_code!=200:raise HTTPException(502,'Gnani could not generate speech. Please try later.')
            chunks=[];size=0
            for chunk in result.iter_content(65536):
                size+=len(chunk)
                if size>MAX_AUDIO:raise HTTPException(502,'Generated audio exceeded the read-back limit.')
                chunks.append(chunk)
            raw=b''.join(chunks)
    except requests.Timeout:
        raise HTTPException(504,'Speech generation timed out. Wait before trying again; the provider may have processed the first request.') from None
    except requests.RequestException:
        raise HTTPException(502,'Could not receive audio from Gnani. Please try later.') from None
    raw=validate_wav(raw)
    return Response(raw,media_type='audio/wav',headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})

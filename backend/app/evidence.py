"""Human-reviewed online demo photos. No automated image verification."""
import hashlib
import json
import warnings
from io import BytesIO
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID
from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from app.fact_reviews import scoped_connection

router=APIRouter(prefix='/api',tags=['Demo evidence'])
MAX_BYTES=5*1024*1024
MAX_PIXELS=16_000_000

def clean_image(raw):
    if not raw or len(raw)>MAX_BYTES:raise HTTPException(413,'Choose an image between 1 byte and 5 MB.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error',Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as image:
                if image.format not in ('JPEG','PNG','WEBP'):
                    raise HTTPException(415,'Choose a JPEG, PNG or WebP image.')
                if image.width*image.height>MAX_PIXELS:raise HTTPException(413,'Choose an image under 16 megapixels.')
                image.load()
                output=BytesIO()
                normalized=ImageOps.exif_transpose(image).convert('RGB')
                normalized.thumbnail((2000,2000))
                normalized.save(output,format='JPEG',quality=85)
                result=output.getvalue()
                if len(result)>MAX_BYTES:raise HTTPException(413,'The processed image is too large.')
                return result
    except (UnidentifiedImageError,OSError,ValueError,Image.DecompressionBombError,Image.DecompressionBombWarning):
        raise HTTPException(415,'This file could not be decoded as a supported image.') from None

def check_review(conn,org,review_id):
    row=conn.execute('SELECT id FROM sentinel.extraction_reviews WHERE id=%s AND organization_id=%s',(review_id,org)).fetchone()
    if not row:raise HTTPException(404,'Fact review not found.')

def metadata(row):
    return {'evidence_id':str(row[0]),'source_url':row[1],'claim_checked':row[2],
      'observation':row[3],'assessment':row[4],'created_at':row[5].isoformat(),
      'image_url':f'/api/evidence/{row[0]}/image','source_kind':row[6],
      'review_source':'local_demo','assessment_method':'human_review','persistence_status':'saved'}

@router.get('/fact-reviews/{review_id}/evidence')
def list_evidence(review_id:UUID,response:Response,offset:int=Query(0,ge=0)):
    response.headers['Cache-Control']='no-store'
    with scoped_connection() as (conn,org):
        check_review(conn,org,review_id)
        rows=conn.execute('''SELECT id,source_url,claim_checked,observation,assessment,created_at,source_kind
           FROM sentinel.demo_evidence WHERE review_id=%s AND organization_id=%s
           ORDER BY created_at DESC,id DESC LIMIT 11 OFFSET %s''',(review_id,org,offset)).fetchall()
    return {'review_id':str(review_id),'evidence':[metadata(r) for r in rows[:10]],'offset':offset,'has_more':len(rows)>10}

@router.post('/fact-reviews/{review_id}/evidence')
def add_evidence(review_id:UUID,
    request_id:Annotated[UUID,Form()],source_url:Annotated[str,Form(max_length=2000)],
    claim_checked:Annotated[str,Form(min_length=1,max_length=2000)],
    observation:Annotated[str,Form(min_length=1,max_length=4000)],
    assessment:Annotated[Literal['supports','conflicts','cannot_verify'],Form()],
    image:Annotated[UploadFile,File()],
    source_kind:Annotated[Literal['online_demo','ai_generated_demo'],Form()]='online_demo'):
    url=source_url.strip();claim=claim_checked.strip();note=observation.strip()
    try:parsed=urlsplit(url);host=parsed.hostname
    except ValueError:raise HTTPException(422,'Enter a valid public source URL.') from None
    if parsed.scheme not in ('http','https') or not host or parsed.username or parsed.password:
        raise HTTPException(422,'Use an http or https source URL without credentials.')
    if not claim or not note:raise HTTPException(422,'Enter both the claim and your visible observations.')
    # Check scope before reading or decoding the image.
    with scoped_connection() as (conn,org):check_review(conn,org,review_id)
    try:raw=image.file.read(MAX_BYTES+1)
    finally:image.file.close()
    fingerprint=hashlib.sha256(json.dumps([str(review_id),url,claim,note,assessment,source_kind],ensure_ascii=False).encode()+b'\0'+raw).hexdigest()
    normalized=clean_image(raw)
    with scoped_connection() as (conn,org):
        check_review(conn,org,review_id)
        conn.execute('''INSERT INTO sentinel.demo_evidence
          (id,organization_id,review_id,source_url,claim_checked,observation,assessment,request_hash,image_bytes,source_kind)
          VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING''',
          (request_id,org,review_id,url,claim,note,assessment,fingerprint,normalized,source_kind))
        row=conn.execute('''SELECT id,source_url,claim_checked,observation,assessment,created_at,source_kind,request_hash
           FROM sentinel.demo_evidence WHERE id=%s AND organization_id=%s AND review_id=%s''',(request_id,org,review_id)).fetchone()
        if not row or row[7]!=fingerprint:raise HTTPException(409,'This request ID was already used for different evidence. Reload saved evidence.')
        result=metadata(row)
    return {'review_id':str(review_id),'evidence':result}

@router.get('/evidence/{evidence_id}/image')
def evidence_image(evidence_id:UUID):
    with scoped_connection() as (conn,org):
        row=conn.execute('SELECT image_bytes FROM sentinel.demo_evidence WHERE id=%s AND organization_id=%s',(evidence_id,org)).fetchone()
        if not row:raise HTTPException(404,'Evidence image not found.')
        data=bytes(row[0])
    return Response(data,media_type='image/jpeg',headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})

"""Conservative equipment suggestions from the account's machine list; no model call."""
import re
import unicodedata
from difflib import SequenceMatcher
from uuid import UUID
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from app.database import get_connection
from app.identity import principal
from app.access import require_owned
from app.worker_machines import LATEST

router=APIRouter(prefix='/api/attempts',tags=['Equipment wording check'])
class CheckText(BaseModel):
    model_config=ConfigDict(extra='forbid')
    text:str=Field(min_length=1,max_length=20000)

ALIASES={
 'motor':('motor','मोटर','মোটর'),
 'pump':('pump','पंप','पम्प','পাম্প'),
 'compressor':('compressor','कंप्रेसर','কম্প্রেসর'),
}
NUMBERS={}
for words in (
 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty',
 'शून्य एक दो तीन चार पांच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस बीस',
 'শূন্য এক দুই তিন চার পাঁচ ছয় সাত আট নয় দশ এগারো বারো তেরো চোদ্দো পনেরো ষোলো সতেরো আঠারো উনিশ কুড়ি'):
    NUMBERS.update({word:str(i) for i,word in enumerate(words.split())})
NUMBERS.update({'पन्द्रह':'15','पाँच':'5','छः':'6','চৌদ্দ':'14','পনের':'15','সাত':'7','तीस':'30','thirty':'30','forty':'40','fifty':'50','sixty':'60','seventy':'70','eighty':'80','ninety':'90'})
SKIP={'number','no','नंबर','नम्बर','নম্বর'}
def norm(s):return unicodedata.normalize('NFKC',s).casefold()
def number(s):
    s=norm(s)
    if s.isdecimal():return str(int(s))
    return NUMBERS.get(s)

def available_machines(conn):
    u=principal()
    if u.role=='worker':
        return conn.execute('WITH latest AS ('+LATEST+') SELECT m.id,m.code,m.name FROM latest e JOIN sentinel.machines m ON m.id=e.machine_id AND m.organization_id=e.organization_id WHERE e.active AND m.active ORDER BY m.code',(u.organization_id,u.account_id)).fetchall()
    return conn.execute('SELECT id,code,name FROM sentinel.machines WHERE organization_id=%s AND active ORDER BY code',(u.organization_id,)).fetchall()

def equipment_warnings(text,machines):
    tokens=list(re.finditer(r'[A-Za-z0-9]+|[\u0900-\u097f]+|[\u0980-\u09ff]+',text))
    warnings=[]
    for i,t in enumerate(tokens):
        token=norm(t.group())
        if number(token) is not None or len(token)<3:continue
        candidates=[]
        for mid,code,name in machines:
            name_parts=re.findall(r'[A-Za-z]+|\d+',norm(name))
            if len(name_parts)!=2 or not name_parts[1].isdigit():continue
            stem,ident=name_parts;ident=str(int(ident))
            aliases=ALIASES.get(stem,(stem,))
            exact=token in aliases
            # Fuzzy suggestions are limited to Latin names; no invented Indic transliteration.
            similarity=max(SequenceMatcher(None,token,a).ratio() for a in aliases if a.isascii()) if token.isascii() else 0
            if not exact and (similarity<0.6 or token[0]!=stem[0]):continue
            nearby=[]
            for j in (i+1,i-1,i+2,i-2):
                if not 0<=j<len(tokens):continue
                between=tokens[min(i,j)+1:max(i,j)]
                if any(norm(b.group()) not in SKIP for b in between):continue
                # Never bridge a sentence boundary or arbitrary symbols.
                gap=text[tokens[min(i,j)].end():tokens[max(i,j)].start()]
                if any(c in gap for c in '.!?।\n'):continue
                n=number(tokens[j].group())
                if n is not None:nearby.append((j,n))
            if not nearby and not exact:
                # Suggest the name word only; never invent an unspoken machine number.
                candidates.append({'machine_id':str(mid),'name':name.split()[0],'code':code,'start':t.start(),'end':t.end(),'heard':t.group(),'replacement':name.split()[0]})
            for j,n in nearby:
                if n!=ident:continue  # Do not guess a different equipment number.
                if exact:break
                start=min(t.start(),tokens[j].start());end=max(t.end(),tokens[j].end())
                candidates.append({'machine_id':str(mid),'name':name,'code':code,'start':start,'end':end,'heard':text[start:end],'replacement':name})
        # Suggest only a unique machine for this span; duplicate names need manual review.
        unique={c['machine_id']:c for c in candidates}
        if len(unique)==1:
            c=next(iter(unique.values()))
            warnings.append(c)
    return warnings[:8]

def require_latest(conn,attempt_id,lock=False):
    u=principal()
    require_owned(conn,'attempt',attempt_id)
    row=conn.execute('SELECT report_id FROM sentinel.transcription_attempts WHERE id=%s AND organization_id=%s',(attempt_id,u.organization_id)).fetchone()
    if lock:conn.execute('SELECT id FROM sentinel.reports WHERE id=%s AND organization_id=%s FOR UPDATE',(row[0],u.organization_id)).fetchone()
    latest=conn.execute('SELECT id FROM sentinel.transcription_attempts WHERE report_id=%s AND organization_id=%s ORDER BY attempt_number DESC LIMIT 1',(row[0],u.organization_id)).fetchone()
    if not latest or str(latest[0])!=str(attempt_id):raise HTTPException(409,'A newer report version exists. Refresh Report history.')
    return row[0]

@router.post('/{attempt_id}/equipment-check')
def check_equipment(attempt_id:UUID,body:CheckText):
    if principal().role not in ('owner','worker'):raise HTTPException(403,'Owner or submitting worker access is required.')
    with get_connection() as conn:
        require_latest(conn,attempt_id)
        warnings=equipment_warnings(body.text,available_machines(conn))
    return {'warnings':warnings,'method':'machine-list-wording-check'}

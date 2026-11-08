"""Owner-only PDF text preview. No permanent file, document, report or provider write."""
from collections import deque
import hashlib,json,os,subprocess,sys,threading,time
from pathlib import Path
from fastapi import APIRouter,HTTPException,UploadFile
from app.machine_references import owner

router=APIRouter(prefix='/api/machine-references',tags=['PDF reference import'])
_slot=threading.Lock();_guard=threading.Lock();_recent={}
MAX_BYTES=5*1024*1024
ERRORS={
 'invalid_pdf':(422,'This PDF could not be read reliably. Use a valid text-based PDF or paste a checked text excerpt.'),
 'encrypted_pdf':(422,'Encrypted PDFs are not supported. Use an authorized unencrypted copy or paste a checked text excerpt.'),
 'page_limit':(422,'Use a PDF with 1–20 pages. No partial document was imported.'),
 'file_limit':(413,'Use a PDF up to 5 MiB.'),
 'text_limit':(422,'The extracted text exceeds 8,000 characters. Use a smaller self-contained excerpt that retains its warnings and prerequisites. No text was truncated.'),
 'no_page_text':(422,'At least one PDF page has no extractable text. Scans and image-only pages need a separate reviewed text/OCR workflow; this import was not partially accepted.'),
 'unreadable_text':(422,'Some extracted text could not be decoded reliably. Compare with the PDF and prepare a checked plain-text excerpt instead.'),
 'complex_pdf':(422,'This PDF is too complex for the bounded text importer. Use a simpler text-based excerpt.'),
 'dependency_missing':(503,'PDF import needs its Python dependency. Run pip install -r backend/pdf_import_requirements.txt with the project virtual environment.'),
}

@router.post('/pdf-preview')
def preview_pdf(pdf:UploadFile):
    user=owner()
    if Path(pdf.filename or '').suffix.lower()!='.pdf':raise HTTPException(415,'Choose a PDF file.')
    payload=pdf.file.read(MAX_BYTES+1)
    if not payload:raise HTTPException(400,'The PDF file is empty.')
    if len(payload)>MAX_BYTES:raise HTTPException(413,'Use a PDF up to 5 MiB.')
    if not payload.startswith(b'%PDF-'):raise HTTPException(415,'This file does not have a valid PDF header.')
    now=time.monotonic();key=(str(user.organization_id),str(user.account_id))
    with _guard:
        for old in list(_recent):
            while _recent[old] and _recent[old][0]<=now-60:_recent[old].popleft()
            if not _recent[old]:del _recent[old]
        queue=_recent.setdefault(key,deque())
        if len(queue)>=5:raise HTTPException(429,'Wait a minute before previewing more PDFs.')
        queue.append(now)
    if not _slot.acquire(blocking=False):raise HTTPException(429,'Another PDF is being processed. Wait and try again.')
    try:
        try:
            process=subprocess.run([sys.executable,str(Path(__file__).with_name('pdf_text_worker.py'))],
                input=payload,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=15,
                env={**os.environ,'PYTHONIOENCODING':'utf-8'})
        except subprocess.TimeoutExpired:raise HTTPException(504,'PDF text extraction timed out. No document was saved; try a simpler text-based excerpt.') from None
        except OSError:raise HTTPException(503,'The PDF extraction process could not start.') from None
        if process.returncode!=0 or len(process.stdout)>128000:raise HTTPException(422,'This PDF could not be processed within the import limits. No document was saved.')
        try:data=json.loads(process.stdout)
        except (ValueError,UnicodeError):raise HTTPException(422,'The PDF parser returned unreadable text. No document was saved.') from None
        if not isinstance(data,dict):raise HTTPException(422,'Invalid PDF extraction response.')
        if data.get('error'):
            status,message=ERRORS.get(data['error'],ERRORS['invalid_pdf']) if isinstance(data['error'],str) else ERRORS['invalid_pdf'];raise HTTPException(status,message)
        if set(data)!={'text','page_count'} or not isinstance(data['text'],str) or not data['text'].strip() or len(data['text'].encode('utf-16-le'))//2>8000 or type(data['page_count']) is not int or not 1<=data['page_count']<=20:
            raise HTTPException(422,'The extracted PDF text did not pass validation.')
        return {**data,'persistence_status':'not_saved','file_sha256':hashlib.sha256(payload).hexdigest(),
            'warning':'Text extraction can omit images, diagrams, symbols, table relationships and reading order. Compare every page with the original PDF, especially warnings, numbers, units and negation. Page markers refer to this input PDF, not printed manual page labels. Only text will be saved; the original PDF is not retained.'}
    finally:_slot.release()

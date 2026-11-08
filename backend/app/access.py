"""Default-deny API permissions. Frontend visibility is not an authorization check."""
import re
from uuid import UUID
import psycopg
from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from app.accounts import authenticate, COOKIE
from app.database import get_connection, read_database_settings
from app.identity import current_identity, principal

def check_csrf(request: Request):
    if request.method in ('GET', 'HEAD', 'OPTIONS'):
        return
    origins = read_database_settings().get('SENTINEL_ALLOWED_ORIGINS') or 'http://127.0.0.1:5173,http://localhost:5173'
    allowed = {s.strip() for s in origins.split(',')}
    if request.headers.get('x-sentinel-request') != '1' or request.headers.get('origin') not in allowed:
        raise HTTPException(403, 'Request origin could not be verified. Open the app at its configured address.')

class AccountMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        token = None
        try:
            if request.url.path.startswith('/api/'):
                await run_in_threadpool(check_csrf, request)
                if request.url.path != '/api/auth/login':
                    user = await run_in_threadpool(authenticate, request.cookies.get(COOKIE))
                    if user is None:
                        raise HTTPException(401, 'Sign in to continue.')
                    token = current_identity.set(user)
            response = await call_next(request)
            if request.url.path.startswith('/api/'):
                response.headers['Cache-Control'] = 'no-store'
            return response
        except HTTPException as error:
            return JSONResponse({'detail': error.detail}, status_code=error.status_code, headers={'Cache-Control':'no-store'})
        except (psycopg.Error, OSError, RuntimeError, ValueError):
            return JSONResponse({'detail': 'Account service unavailable. Check database migration 008 and try again.'}, status_code=503)
        finally:
            if token is not None:
                current_identity.reset(token)

def report_for(conn, org, kind, value):
    tables = {
      'report': 'SELECT id,created_by_account_id FROM sentinel.reports WHERE id=%s AND organization_id=%s',
      'attempt': '''SELECT p.id,p.created_by_account_id FROM sentinel.transcription_attempts a
        JOIN sentinel.reports p ON p.id=a.report_id AND p.organization_id=a.organization_id
        WHERE a.id=%s AND a.organization_id=%s''',
      'extraction': '''SELECT p.id,p.created_by_account_id FROM sentinel.report_extractions x
        JOIN sentinel.transcription_attempts a ON a.id=x.attempt_id AND a.organization_id=x.organization_id
        JOIN sentinel.reports p ON p.id=a.report_id AND p.organization_id=a.organization_id
        WHERE x.id=%s AND x.organization_id=%s''',
      'review': '''SELECT p.id,p.created_by_account_id FROM sentinel.extraction_reviews r
        JOIN sentinel.report_extractions x ON x.id=r.extraction_id AND x.organization_id=r.organization_id
        JOIN sentinel.transcription_attempts a ON a.id=x.attempt_id AND a.organization_id=x.organization_id
        JOIN sentinel.reports p ON p.id=a.report_id AND p.organization_id=a.organization_id
        WHERE r.id=%s AND r.organization_id=%s''',
      'evidence': '''SELECT p.id,p.created_by_account_id FROM sentinel.demo_evidence e
        JOIN sentinel.extraction_reviews r ON r.id=e.review_id AND r.organization_id=e.organization_id
        JOIN sentinel.report_extractions x ON x.id=r.extraction_id AND x.organization_id=r.organization_id
        JOIN sentinel.transcription_attempts a ON a.id=x.attempt_id AND a.organization_id=x.organization_id
        JOIN sentinel.reports p ON p.id=a.report_id AND p.organization_id=a.organization_id
        WHERE e.id=%s AND e.organization_id=%s'''}
    return conn.execute(tables[kind], (value, org)).fetchone()

def require_owned(conn, kind, value):
    user = principal()
    row = report_for(conn, user.organization_id, kind, value)
    if row is None or (user.role == 'worker' and row[1] != user.account_id):
        raise HTTPException(404, 'Report not found or not available to this account.')

def technician_assignment(conn, review_id):
    user = principal()
    last = conn.execute('SELECT technician_id FROM sentinel.repair_events WHERE review_id=%s AND organization_id=%s ORDER BY sequence_number DESC LIMIT 1', (review_id, user.organization_id)).fetchone()
    if not last or last[0] != user.technician_id:
        raise HTTPException(404, 'This task is not assigned to your account.')

def authorize(request: Request):
    path = request.url.path.rstrip('/')
    if not path.startswith('/api/') or path == '/api/auth/login':
        return
    user = principal()
    if path in ('/api/auth/me', '/api/auth/logout', '/api/auth/password'):
        return
    if path in ('/api/ask-sentinel','/api/ask-sentinel/references','/api/ask-sentinel/readback','/api/ask-sentinel/transcribe'):
        if user.role not in ('owner','worker','technician'):raise HTTPException(403,'Factory account access is required.')
        return
    if re.fullmatch(r'/api/machine-admin(?:/[^/]+)?',path):
        if user.role!='owner':raise HTTPException(403,'Only the factory owner can manage machines.')
        return
    if path=='/api/machine-references/machines' and request.method=='GET':
        if user.role not in ('owner','worker','technician'):raise HTTPException(403,'Factory account access is required.')
        return
    if re.fullmatch(r'/api/machine-references(?:/[^/]+)?',path):
        if user.role!='owner':raise HTTPException(403,'Only the factory owner can manage reference documents.')
        return
    if re.fullmatch(r'/api/redline-alerts(?:/[^/]+)?',path):
        if user.role!='owner':raise HTTPException(403,'Only the factory owner can view REDLINE alerts.')
        return
    if re.fullmatch(r'/api/checklists/(?:template/[^/]+|submit/[^/]+|link/[^/]+|submissions)',path):
        # The checklist endpoints check their specific roles and machine assignments.
        if user.role not in ('owner','worker'):raise HTTPException(403,'Worker or owner access is required.')
        return
    if path=='/api/owner-work-board':
        if user.role!='owner':raise HTTPException(403,'Only the factory owner can view the work board.')
        return
    if path=='/api/analytics':
        if user.role!='owner':raise HTTPException(403,'Only the factory owner can view maintenance analytics.')
        return
    if path=='/api/worker-machine-options':
        if user.role!='owner':raise HTTPException(403,'Owner access is required.')
        return
    if path=='/api/worker-machines':
        if user.role not in ('owner','worker') or (request.method!='GET' and user.role!='owner'):
            raise HTTPException(403,'Owner access is required to change worker assignments.')
        return
    if re.fullmatch(r'/api/account-admin(?:/[^/]+/(?:password|active))?',path):
        if user.role!='owner':
            raise HTTPException(403,'Only the factory owner can manage accounts.')
        return
    # Explicitly enumerate existing routes, including owner access; future APIs fail closed.
    patterns = [r'/api/speech/(?:transcribe|typed)', r'/api/reports', r'/api/reports/[^/]+',
      r'/api/attempts/[^/]+/(review|extraction|extraction-preview|readback|preview-readback|equipment-check|corrections)', r'/api/machines',
      r'/api/extractions/[^/]+/review', r'/api/fact-reviews/[^/]+/(machine-link|memory|evidence|redline|repairs)',
      r'/api/evidence/[^/]+/image', r'/api/machines/[^/]+/reports', r'/api/overview', r'/api/work-queue']
    if not any(re.fullmatch(p, path) for p in patterns):
        raise HTTPException(403, 'This operation is not available to your account.')
    if user.role == 'owner':
        return
    if user.role == 'technician':
        if path == '/api/work-queue' and request.method == 'GET':
            return
        if re.fullmatch(r'/api/fact-reviews/[^/]+/repairs', path):
            with get_connection() as conn:
                technician_assignment(conn, UUID(str(request.path_params['review_id'])))
            return
        raise HTTPException(403, 'Technicians can access their assigned work only.')
    if path in ('/api/speech/transcribe', '/api/speech/typed', '/api/reports', '/api/machines'):
        return
    params = request.path_params
    if 'report_id' in params:
        kind, value = 'report', params['report_id']
    elif 'attempt_id' in params:
        kind, value = 'attempt', params['attempt_id']
    elif 'extraction_id' in params:
        kind, value = 'extraction', params['extraction_id']
    elif 'evidence_id' in params:
        kind, value = 'evidence', params['evidence_id']
    elif 'review_id' in params:
        suffix = path.split('/')[-1]
        if suffix not in ('evidence', 'redline', 'repairs') or (suffix == 'repairs' and request.method != 'GET'):
            raise HTTPException(403, 'Ask the owner to manage this factory record.')
        kind, value = 'review', params['review_id']
    else:
        raise HTTPException(403, 'Owner access is required.')
    try:
        value = UUID(str(value))
    except ValueError:
        raise HTTPException(422, 'Invalid record identifier.') from None
    with get_connection() as conn:
        require_owned(conn, kind, value)

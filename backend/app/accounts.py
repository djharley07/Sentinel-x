"""Password accounts and revocable opaque sessions for the local factory."""
import hashlib
import hmac
import secrets
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from app.database import get_connection, read_database_settings
from app.identity import Identity, principal

router = APIRouter(prefix='/api/auth', tags=['Accounts'])
COOKIE = 'sentinel_session'
SESSION_SECONDS = 8 * 60 * 60

def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    value = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=32)
    return f'scrypt${salt}${value.hex()}'

def verify_password(password: str, encoded: str) -> bool:
    try:
        kind, salt, _ = encoded.split('$')
        return kind == 'scrypt' and hmac.compare_digest(hash_password(password, salt), encoded)
    except (ValueError, TypeError):
        return False

DUMMY_HASH = hash_password('Unused account timing comparison')

def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

def public(user: Identity):
    return {'account_id': str(user.account_id), 'username': user.username,
            'display_name': user.display_name, 'role': user.role,
            'technician_id': str(user.technician_id) if user.technician_id else None}

def authenticate(token: str | None) -> Identity | None:
    if not token or len(token) > 128:
        return None
    with get_connection() as conn:
        row = conn.execute('''SELECT a.id,a.organization_id,a.username,a.display_name,a.role,a.technician_id
          FROM sentinel.sessions s JOIN sentinel.accounts a ON a.id=s.account_id
          WHERE s.token_hash=%s AND s.expires_at>now() AND a.active''', (digest(token),)).fetchone()
    return Identity(*row) if row else None

class Login(BaseModel):
    model_config = ConfigDict(extra='forbid')
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)

@router.post('/login')
def login(body: Login, request: Request, response: Response):
    username = body.username.strip().lower()
    # Both account and network limits are shared across server processes.
    keys = sorted(['user:' + digest(username), 'ip:' + digest(request.client.host if request.client else 'unknown')])
    blocked = False
    user = None
    with get_connection() as conn:
        for key in keys:
            conn.execute('INSERT INTO sentinel.login_limits(key) VALUES(%s) ON CONFLICT DO NOTHING', (key,))
            attempts, fresh = conn.execute('SELECT attempts,window_start>now()-interval \'15 minutes\' FROM sentinel.login_limits WHERE key=%s FOR UPDATE', (key,)).fetchone()
            if not fresh:
                conn.execute('UPDATE sentinel.login_limits SET attempts=0,window_start=now() WHERE key=%s', (key,))
            elif attempts >= (10 if key.startswith('user:') else 50):
                blocked = True
        if not blocked:
            row = conn.execute('SELECT id,organization_id,username,display_name,role,technician_id,password_hash,active FROM sentinel.accounts WHERE username=%s FOR UPDATE', (username,)).fetchone()
            valid = verify_password(body.password, row[6] if row else DUMMY_HASH)
            if valid and row and row[7]:
                user = Identity(*row[:6])
                token = secrets.token_urlsafe(32)
                conn.execute('DELETE FROM sentinel.sessions WHERE expires_at<=now() OR token_hash=%s', (digest(request.cookies.get(COOKIE, '')),))
                conn.execute('INSERT INTO sentinel.sessions(token_hash,account_id,expires_at) VALUES(%s,%s,now()+interval \'8 hours\')', (digest(token), user.account_id))
                conn.execute('DELETE FROM sentinel.login_limits WHERE key=%s', ('user:' + digest(username),))
            else:
                for key in keys:
                    conn.execute('UPDATE sentinel.login_limits SET attempts=attempts+1 WHERE key=%s', (key,))
    # Raise after commit so failed attempts are not rolled back.
    if blocked:
        raise HTTPException(429, 'Too many sign-in attempts. Try again in 15 minutes.')
    if user is None:
        raise HTTPException(401, 'Username or password is incorrect.')
    secure = str(read_database_settings().get('SENTINEL_COOKIE_SECURE', 'false')).lower() == 'true'
    response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, httponly=True, secure=secure, samesite='strict', path='/')
    response.headers['Cache-Control'] = 'no-store'
    return public(user)

@router.get('/me')
def me(response: Response):
    response.headers['Cache-Control'] = 'no-store'
    return public(principal())

@router.post('/logout')
def logout(request: Request, response: Response):
    with get_connection() as conn:
        conn.execute('DELETE FROM sentinel.sessions WHERE token_hash=%s', (digest(request.cookies.get(COOKIE, '')),))
    response.delete_cookie(COOKIE, path='/')
    return {'signed_out': True}


class OwnPassword(BaseModel):
    model_config=ConfigDict(extra='forbid')
    current_password:str=Field(min_length=1,max_length=256)
    new_password:str=Field(min_length=12,max_length=256)

@router.post('/password')
def change_own_password(body:OwnPassword):
    user=principal()
    if body.current_password==body.new_password:
        raise HTTPException(400,'Choose a different new password.')
    key='password-change:'+digest(str(user.account_id))
    blocked=False
    invalid=False
    with get_connection() as conn:
        conn.execute('INSERT INTO sentinel.login_limits(key) VALUES(%s) ON CONFLICT DO NOTHING',(key,))
        attempts,fresh=conn.execute("SELECT attempts,window_start>now()-interval '15 minutes' FROM sentinel.login_limits WHERE key=%s FOR UPDATE",(key,)).fetchone()
        if not fresh:
            conn.execute('UPDATE sentinel.login_limits SET attempts=0,window_start=now() WHERE key=%s',(key,))
        elif attempts>=10:
            blocked=True
        if not blocked:
            row=conn.execute('SELECT password_hash,active FROM sentinel.accounts WHERE id=%s AND organization_id=%s FOR UPDATE',(user.account_id,user.organization_id)).fetchone()
            if not row or not row[1]:raise HTTPException(401,'Your account is no longer active.')
            if not verify_password(body.current_password,row[0]):
                invalid=True
                conn.execute('UPDATE sentinel.login_limits SET attempts=attempts+1 WHERE key=%s',(key,))
            else:
                conn.execute('UPDATE sentinel.accounts SET password_hash=%s WHERE id=%s AND organization_id=%s',(hash_password(body.new_password),user.account_id,user.organization_id))
                conn.execute('DELETE FROM sentinel.sessions WHERE account_id=%s',(user.account_id,))
                conn.execute('DELETE FROM sentinel.login_limits WHERE key=%s',(key,))
    if blocked:raise HTTPException(429,'Too many password-change attempts. Try again in 15 minutes.')
    if invalid:raise HTTPException(400,'Your current password is incorrect.')
    return {'password_changed':True,'sign_in_required':True}

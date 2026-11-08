import SignOutFarewell from './SignOutFarewell'
import ChangePassword from './ChangePassword'
import PasswordField from './PasswordField'
import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { apiFetch } from './api'
import './Auth.css'

export type Account = { account_id: string; username: string; display_name: string; role: 'owner' | 'worker' | 'technician'; technician_id: string | null }
const AccountContext = createContext<Account | null>(null)
export function useAccount(): Account {
  const user = useContext(AccountContext)
  if (!user) throw new Error('Account context is missing.')
  return user
}
function valid(value: unknown): value is Account {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return ['account_id','username','display_name'].every(k => typeof v[k] === 'string') &&
    ['owner','worker','technician'].includes(v.role as string) &&
    (v.technician_id === null || typeof v.technician_id === 'string')
}
export default function AuthGate({ children }: { children: ReactNode }) {
  const [user,setUser] = useState<Account | null>(null)
  const [loading,setLoading] = useState(true)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const [farewell,setFarewell] = useState(false)
  const [profile,setProfile] = useState(false)
  const [username,setUsername] = useState('')
  const [password,setPassword] = useState('')
  useEffect(() => {
    let active = true
    const c = new AbortController()
    const timer = window.setTimeout(() => c.abort(), 30000)
    apiFetch('/api/auth/me', { signal: c.signal }).then(async r => {
      if (r.status === 401) return
      const value: unknown = await r.json()
      if (!r.ok || !valid(value)) throw new Error('Could not check your account. Check the backend and migration 008.')
      if (active) setUser(value)
    }).catch(() => { if (active) setError('Could not check your account. Check the backend and migration 008, then try signing in.') })
      .finally(() => { window.clearTimeout(timer); if (active) setLoading(false) })
    const expired = () => { setProfile(false); setNotice(''); setUser(null); setPassword(''); setError('Your session ended. Sign in again to load saved work.') }
    window.addEventListener('sentinel-session-expired', expired)
    return () => { active = false; window.clearTimeout(timer); c.abort(); window.removeEventListener('sentinel-session-expired', expired) }
  }, [])
  async function signIn(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const r = await apiFetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(30000) })
      const value = await r.json()
      if (!r.ok) throw new Error(typeof value.detail === 'string' ? value.detail : 'Sign-in failed.')
      if (!valid(value)) throw new Error('Unexpected account response.')
      setUser(value); setPassword('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Sign-in failed.') }
    finally { setBusy(false) }
  }
  async function signOut() {
    if (busy || !window.confirm('Sign out? Finish or confirm any pending saves first. Unsaved form values will be cleared.')) return
    setBusy(true); setError(''); setNotice('')
    try {
      const r = await apiFetch('/api/auth/logout', { method:'POST', signal: AbortSignal.timeout(30000) })
      if (!r.ok) throw new Error('Could not confirm sign-out. Try again.')
      setUser(null); setPassword(''); setProfile(false); setFarewell(true)
    } catch (e) { setError(e instanceof Error ? e.message : 'Sign-out failed.') }
    finally { setBusy(false) }
  }
  if (loading) return <main className="auth-screen"><p role="status">Checking account…</p></main>
  if (!user && farewell) return <SignOutFarewell onDone={()=>setFarewell(false)} />
  if (!user) return <main className="auth-screen"><form className="card auth-form" onSubmit={signIn}>
    <p className="eyebrow">SENTINEL X · FACTORY ACCOUNTS</p><h1>Sign in</h1>
    <p>Use the account created by your local administrator.</p>
    <label>Username<input autoComplete="username" required maxLength={64} value={username} onChange={e=>setUsername(e.target.value)} disabled={busy}/></label>
    <PasswordField label="Password" autoComplete="current-password" required maxLength={256} value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/>
    <button disabled={busy}>{busy?'Signing in…':'Sign in'}</button>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <p className="hint">Local factory demo · Owner, worker and technician access is enforced by the server.</p>
  </form></main>
  return <AccountContext.Provider value={user}><div className="account-bar"><span><strong>{user.display_name}</strong> · {user.role}</span><div className="account-bar-actions"><button className="secondary" disabled={busy} onClick={()=>setProfile(value=>!value)}>{profile?'Close my account':'My account'}</button><button className="secondary" disabled={busy} onClick={signOut}>Sign out</button></div></div>{error&&<p className="error" role="alert">{error}</p>}{profile&&<ChangePassword onBusy={setBusy} onChanged={()=>{setUser(null);setProfile(false);setPassword('');setError('');setNotice('Password changed. Sign in with your new password.')}}/>}{children}</AccountContext.Provider>
}

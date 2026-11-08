import { useRef, useState, type FormEvent } from 'react'
import PasswordField from './PasswordField'
import { apiFetch } from './api'

export default function ChangePassword({onChanged,onBusy}:{onChanged:()=>void;onBusy:(value:boolean)=>void}){
 const [current,setCurrent]=useState(''),[next,setNext]=useState(''),[repeat,setRepeat]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false)
 const inFlight=useRef(false)
 async function save(e:FormEvent){
  e.preventDefault();if(inFlight.current||uncertain)return
  if(next!==repeat){setError('The new passwords must match.');return}
  if(next===current){setError('Choose a different new password.');return}
  if(!window.confirm('Change your password and sign out all sessions? Finish or confirm any pending saves first. Unsaved form values will be cleared.'))return
  inFlight.current=true;setBusy(true);onBusy(true);setError('')
  try{
   const r=await apiFetch('/api/auth/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({current_password:current,new_password:next}),signal:AbortSignal.timeout(30000)})
   const d=await r.json()
   if(!r.ok){if(r.status>=500)setUncertain(true);throw new Error(typeof d.detail==='string'?d.detail:'Could not change password.')}
   if(d.password_changed!==true||d.sign_in_required!==true){setUncertain(true);throw new Error('Could not confirm the password change.')}
   setCurrent('');setNext('');setRepeat('');onChanged()
  }catch(e){if(e instanceof Error&&['TimeoutError','AbortError','TypeError'].includes(e.name))setUncertain(true);setError(e instanceof Error?e.message:'Password change failed.')}
  finally{inFlight.current=false;setBusy(false);onBusy(false)}
 }
 return <section className="card my-account"><h2>My account · Change password</h2><p>Enter your current password and choose a new password. Saving signs out all sessions, including this one.</p>
  <form onSubmit={save}><fieldset disabled={busy||uncertain}>
   <PasswordField label="Current password" autoComplete="current-password" required maxLength={256} value={current} onChange={e=>setCurrent(e.target.value)}/>
   <PasswordField label="New password" autoComplete="new-password" required minLength={12} maxLength={256} value={next} onChange={e=>setNext(e.target.value)}/>
   <PasswordField label="Repeat new password" autoComplete="new-password" required minLength={12} maxLength={256} value={repeat} onChange={e=>setRepeat(e.target.value)}/>
   <button>{busy?'Saving…':'Change password and sign out'}</button>
  </fieldset></form>{error&&<p className="error" role="alert">{error}</p>}
  {uncertain&&<p role="alert">Saving could not be confirmed. Sign out and try your new password first. If it fails, try the previous one. Your local administrator can reset a forgotten password.</p>}
 </section>
}

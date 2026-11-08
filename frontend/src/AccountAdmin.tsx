import PasswordField from './PasswordField'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { apiFetch } from './api'
import './AccountAdmin.css'
type User={account_id:string;username:string;display_name:string;role:'owner'|'worker'|'technician';active:boolean;technician_id:string|null;technician_code:string|null}
type Page={accounts:User[];total:number;offset:number;limit:number;has_more:boolean;available_technicians:{technician_id:string;code:string;name:string}[];recent_actions:{request_id:string;action:string;created_at:string;actor:string;target:string}[]}
type Pending={url:string;body:string;label:string;requestId:string}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'
function userValid(v:unknown):v is User{return object(v)&&['account_id','username','display_name'].every(k=>typeof v[k]==='string')&&['owner','worker','technician'].includes(v.role as string)&&typeof v.active==='boolean'&&(v.technician_id===null||typeof v.technician_id==='string')&&(v.technician_code===null||typeof v.technician_code==='string')}
function pageValid(v:unknown):v is Page{return object(v)&&Array.isArray(v.accounts)&&v.accounts.every(userValid)&&typeof v.total==='number'&&Number.isSafeInteger(v.total)&&typeof v.offset==='number'&&v.limit===20&&typeof v.has_more==='boolean'&&Array.isArray(v.available_technicians)&&v.available_technicians.every(t=>object(t)&&['technician_id','code','name'].every(k=>typeof t[k]==='string'))&&Array.isArray(v.recent_actions)&&v.recent_actions.every(e=>object(e)&&['request_id','action','created_at','actor','target'].every(k=>typeof e[k]==='string'))}
export default function AccountAdmin(){
 const [data,setData]=useState<Page|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [username,setUsername]=useState(''),[name,setName]=useState(''),[role,setRole]=useState<'worker'|'technician'>('worker'),[tech,setTech]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState('')
 const [selected,setSelected]=useState<User|null>(null),[reset,setReset]=useState(''),[resetConfirm,setResetConfirm]=useState(''),[pending,setPending]=useState<Pending|null>(null)
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 const locked=busy||pending!==null
 async function load(offset=0){
  if(active.current)return
  const c=new AbortController();active.current=c;setBusy(true);setError('');const timer=window.setTimeout(()=>c.abort(),30000)
  try{
   const r=await apiFetch(`/api/account-admin?offset=${offset}`,{signal:c.signal});const d:unknown=await r.json()
   if(!r.ok)throw new Error(object(d)&&typeof d.detail==='string'?d.detail:`Account list failed (${r.status}).`)
   if(!pageValid(d)||d.offset!==offset)throw new Error('Unexpected account list response.')
   if(active.current===c)setData(d)
  }catch(e){if(active.current===c)setError(e instanceof Error?e.message:'Could not load accounts.')}
  finally{window.clearTimeout(timer);if(active.current===c){active.current=null;setBusy(false)}}
 }
 async function send(command:Pending){
  if(active.current)return
  const c=new AbortController();active.current=c;setBusy(true);setError('');setNotice('');setPending(command)
  const timer=window.setTimeout(()=>c.abort(),30000)
  try{
   const r=await apiFetch(command.url,{method:'POST',headers:{'Content-Type':'application/json'},body:command.body,signal:c.signal});const d:unknown=await r.json()
   if(!r.ok){
    if([403,404,409,422].includes(r.status))setPending(null)
    throw new Error(object(d)&&typeof d.detail==='string'?d.detail:`Account action failed (${r.status}).`)
   }
   if(!object(d)||d.request_id!==command.requestId||!userValid(d.account)||typeof d.already_applied!=='boolean')throw new Error('Could not confirm the saved action. Retry the same action.')
   if(active.current!==c)return
   setPending(null);setPassword('');setConfirm('');setReset('');setResetConfirm('');setSelected(null)
   setNotice(`${command.label} confirmed for ${d.account.username}. Refresh accounts to see the latest list.`)
   if(command.url==='/api/account-admin'){setUsername('');setName('');setTech('')}
   setData(null)
  }catch(e){if(active.current===c)setError(c.signal.aborted?'Could not confirm saving. Retry the same action; do not submit a different password.':e instanceof Error?e.message:'Account action failed.')}
  finally{window.clearTimeout(timer);if(active.current===c){active.current=null;setBusy(false)}}
 }
 function command(url:string,body:Record<string,unknown>,label:string){const requestId=crypto.randomUUID();return {url,body:JSON.stringify({...body,request_id:requestId}),label,requestId}}
 function create(e:FormEvent){e.preventDefault();if(locked)return;if(password!==confirm){setError('The two passwords must match.');return}void send(command('/api/account-admin',{username:username.trim().toLowerCase(),display_name:name.trim(),role,password,technician_id:role==='technician'&&tech?tech:null},'Account creation'))}
 function resetPassword(e:FormEvent){e.preventDefault();if(locked||!selected)return;if(reset!==resetConfirm){setError('The two new passwords must match.');return}void send(command(`/api/account-admin/${selected.account_id}/password`,{password:reset},'Password reset'))}
 function toggle(u:User){if(locked)return;void send(command(`/api/account-admin/${u.account_id}/active`,{active:!u.active},u.active?'Access disabled':'Access enabled'))}
 return <section className="card account-admin" aria-label="Owner account management">
  <p className="eyebrow">OWNER WORKSPACE / ACCOUNTS</p><h2>Worker and technician accounts</h2>
  <p>Create access for this factory, reset passwords, or enable and disable accounts. Existing reports and work history are retained.</p>
  <button className="secondary" disabled={busy} onClick={()=>load(data?.offset??0)}>{busy?'Working…':data?'Refresh accounts':'Load accounts'}</button>
  {error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {pending&&<div className="account-pending"><p>The result is not yet confirmed. Submitted values are locked. Retrying the same request will not apply it twice.</p><button disabled={busy} onClick={()=>send(pending)}>Retry same action</button></div>}
  {data&&<>
   <p>{data.total} accounts · Showing {data.accounts.length?data.offset+1:0}–{data.offset+data.accounts.length}</p>
   <div className="account-list">{data.accounts.map(u=><article key={u.account_id}>
    <h3>{u.display_name}</h3><p>{u.username} · {u.role} · {u.active?'Enabled':'Disabled'}{u.technician_code?` · ${u.technician_code}`:''}</p>
    {u.role==='owner'?<p className="hint">Protected owner account</p>:<div className="account-actions"><button className="secondary" disabled={locked} onClick={()=>{setSelected(u);setReset('');setResetConfirm('')}}>Reset password</button><button className="secondary" disabled={locked} onClick={()=>toggle(u)}>{u.active?'Disable access':'Enable access'}</button></div>}
   </article>)}</div>
   <div className="account-actions"><button className="secondary" disabled={locked||data.offset===0} onClick={()=>load(Math.max(0,data.offset-20))}>Previous accounts</button><button className="secondary" disabled={locked||!data.has_more} onClick={()=>load(data.offset+20)}>Next accounts</button></div>
   {selected&&<form onSubmit={resetPassword}><h3>Reset password for {selected.username}</h3><p>This signs the account out of existing sessions.</p><fieldset disabled={locked}>
    <PasswordField label="New password" autoComplete="new-password" minLength={12} maxLength={256} required value={reset} onChange={e=>setReset(e.target.value)}/>
    <PasswordField label="Repeat new password" autoComplete="new-password" minLength={12} maxLength={256} required value={resetConfirm} onChange={e=>setResetConfirm(e.target.value)}/>
    <button>Save new password</button><button type="button" className="secondary" onClick={()=>{setSelected(null);setReset('');setResetConfirm('')}}>Cancel</button>
   </fieldset></form>}
   <form onSubmit={create}><h3>Create an account</h3><fieldset disabled={locked}>
    <label>Display name<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label>
    <label>Username<input autoComplete="off" required minLength={3} maxLength={64} pattern="[a-z0-9][a-z0-9_.\-]{2,63}" value={username} onChange={e=>setUsername(e.target.value.toLowerCase())}/><span className="hint">3–64 lowercase letters, numbers, dots, underscores or hyphens.</span></label>
    <label>Account role<select value={role} onChange={e=>{setRole(e.target.value as 'worker'|'technician');setTech('')}}><option value="worker">Worker</option><option value="technician">Technician</option></select></label>
    {role==='technician'&&<label>Technician record<select value={tech} onChange={e=>setTech(e.target.value)}><option value="">Create a new technician record</option>{data.available_technicians.map(t=><option key={t.technician_id} value={t.technician_id}>{t.name} · {t.code}</option>)}</select><span className="hint">Link an unused existing technician to keep their work history, or create a new technician.</span></label>}
    <PasswordField label="Password" autoComplete="new-password" required minLength={12} maxLength={256} value={password} onChange={e=>setPassword(e.target.value)}/>
    <PasswordField label="Repeat password" autoComplete="new-password" required minLength={12} maxLength={256} value={confirm} onChange={e=>setConfirm(e.target.value)}/>
    <button>Create account</button>
   </fieldset><p className="hint">Passwords need at least 12 characters. Saved passwords cannot be viewed. Use fictional accounts for demo testing.</p></form>
   <details><summary>Recent account actions · Latest 20</summary><ul>{data.recent_actions.map(e=><li key={e.request_id}>{e.actor} · {e.action.replaceAll('_',' ')} · {e.target} · {new Date(e.created_at).toLocaleString()}</li>)}</ul>{data.recent_actions.length===0&&<p>No account actions recorded yet.</p>}</details>
  </>}
 </section>
}

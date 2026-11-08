import { useAccount } from './Auth'
import { apiFetch } from './api'
import { useEffect,useRef,useState } from 'react'
type Status='assigned'|'in_progress'|'completed'
type Event={event_id:string;status:Status;action_note:string;outcome:string|null;created_at:string;technician_id:string;technician_name:string;machine_name:string}
type State={review_id:string;current:Event|null;history:Event[];technicians:{technician_id:string;code:string;name:string}[];review_source:'local_demo'}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'
const event=(v:unknown):v is Event=>obj(v)&&['event_id','action_note','created_at','technician_id','technician_name','machine_name'].every(k=>typeof v[k]==='string')&&['assigned','in_progress','completed'].includes(v.status as string)&&(v.outcome===null||['resolved','improved','unresolved','not_checked'].includes(v.outcome as string))
export default function RepairLog({reviewId}:{reviewId:string}){
 const account=useAccount()
 const readOnly=account.role==='worker'
 const technician=account.role==='technician'
 const [data,setData]=useState<State|null>(null),[tech,setTech]=useState(''),[status,setStatus]=useState<Status>('assigned'),[note,setNote]=useState(''),[outcome,setOutcome]=useState('not_checked'),[pending,setPending]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function run(save=false){
  if(active.current)return
  if(save&&!pending&&(!note.trim()||!tech)){setError('Choose a demo technician and enter an action note.');return}
  const c=new AbortController();active.current=c;setBusy(true);setError('');const timer=window.setTimeout(()=>c.abort(),60000)
  try{
   const body=save?(pending??JSON.stringify({request_id:crypto.randomUUID(),previous_event_id:data?.current?.event_id??null,technician_id:tech,status,action_note:note.trim(),outcome:status==='completed'?outcome:null})):undefined
   if(save)setPending(body!)
   const r=await apiFetch(`/api/fact-reviews/${reviewId}/repairs`,{method:save?'POST':'GET',headers:save?{'Content-Type':'application/json'}:undefined,body,signal:c.signal,cache:'no-store'});const d:unknown=await r.json()
   if(!r.ok)throw new Error(obj(d)&&typeof d.detail==='string'?d.detail:`Repair log failed (${r.status}).`)
   if(!obj(d)||d.review_id!==reviewId||!(d.current===null||event(d.current))||!Array.isArray(d.history)||!d.history.every(event)||!Array.isArray(d.technicians)||!d.technicians.every(t=>obj(t)&&['technician_id','code','name'].every(k=>typeof t[k]==='string')))throw new Error('Unexpected repair response.')
   if(active.current!==c||c.signal.aborted)return
   const current=d.current as Event|null
   setData(d as State);setTech(current?.technician_id??'');setStatus(current?.status==='assigned'?'in_progress':current?.status==='in_progress'?'completed':'assigned');setNote('');setOutcome('not_checked');setPending(null)
  }catch(e){if(active.current===c)setError(c.signal.aborted?'Request timed out. Reload to check saved state, or retry the same update.':e instanceof Error?e.message:'Could not save repair update.')}
  finally{window.clearTimeout(timer);if(active.current===c){active.current=null;setBusy(false)}}
 }
 return <section className="repair-log-form" aria-label="Assignments and repair log" style={{borderTop:'1px solid #64748b',paddingTop:12,marginTop:16}}>
  <h5>Technician assignment and repair log</h5><p className="hint">Fictional demo technicians · Reported actions and outcomes. These records do not certify machine safety or notify real people.</p>
  <button className="secondary" disabled={busy} onClick={()=>run()}>{data?'Reload repair log':'Load assignment and repair log'}</button>
  {error&&<p className="error" role="alert">{error}</p>}{busy&&<p role="status">Working…</p>}
  {data&&<><p><strong>{data.current?`${data.current.status.replaceAll('_',' ')} · ${data.current.technician_name} · ${data.current.machine_name}`:'No work assigned'}</strong></p>
   {!readOnly && !(technician && data.current?.status==='completed') && <><fieldset disabled={busy||pending!==null} style={{border:0,padding:0,display:'grid',gap:10}}>
    <label>Demo technician<select disabled={technician} style={{display:'block',width:'100%'}} value={tech} onChange={e=>setTech(e.target.value)}><option value="">Select a technician</option>{data.technicians.map(t=><option key={t.technician_id} value={t.technician_id}>{t.name} · {t.code}</option>)}</select></label>
    <label>Work status<select style={{display:'block',width:'100%'}} value={status} onChange={e=>setStatus(e.target.value as Status)}>{!technician&&<option value="assigned">Assign / reassign work</option>}{data.current&&data.current.status!=='completed'&&<option value="in_progress">Work in progress</option>}{data.current?.status==='in_progress'&&<option value="completed">Work completed</option>}</select></label>
    <label>Action or assignment note<textarea style={{display:'block',width:'100%',boxSizing:'border-box'}} maxLength={4000} value={note} onChange={e=>setNote(e.target.value)}/></label>
    {status==='completed'&&<label>Reported outcome<select style={{display:'block',width:'100%'}} value={outcome} onChange={e=>setOutcome(e.target.value)}><option value="not_checked">Not checked</option><option value="resolved">Reported resolved</option><option value="improved">Reported improved</option><option value="unresolved">Reported unresolved</option></select></label>}
   </fieldset>
   <button disabled={busy} onClick={()=>run(true)}>{pending?'Retry same update':'Save assignment / repair update'}</button>
   {pending&&<p className="hint">The submitted values are locked until confirmed. Reload to recover saved state.</p>}
   </>}
   <details><summary>Work audit history ({data.history.length})</summary><ul>{data.history.map(e=><li key={e.event_id}><strong>{e.status.replaceAll('_',' ')}</strong> · {e.technician_name} · {e.machine_name}<p>{e.action_note}</p>{e.outcome&&<p>Reported outcome: {e.outcome.replaceAll('_',' ')}</p>}<p className="hint">{new Date(e.created_at).toLocaleString()}</p></li>)}</ul></details>
   <p className="hint">Changing the technician or machine requires a new assignment. Completing work does not automatically resolve REDLINE.</p>
  </>}
 </section>
}

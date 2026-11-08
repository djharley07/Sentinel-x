import { useAccount } from './Auth'
import { apiFetch } from './api'
import { useEffect,useRef,useState } from 'react'
type Status='open'|'acknowledged'|'resolved'
type Event={event_id:string;status:Status;note:string;created_at:string}
type State={review_id:string;current:Event|null;history:Event[];notification_status:'in_app_only'}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'
const event=(v:unknown):v is Event=>obj(v)&&typeof v.event_id==='string'&&['open','acknowledged','resolved'].includes(v.status as string)&&typeof v.note==='string'&&typeof v.created_at==='string'&&Number.isFinite(Date.parse(v.created_at))
export default function Redline({reviewId,autoLoad=false,onLockChange}:{reviewId:string;autoLoad?:boolean;onLockChange?:(locked:boolean)=>void}){
 const account=useAccount()
 const [data,setData]=useState<State|null>(null),[note,setNote]=useState(''),[pending,setPending]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 useEffect(()=>{if(autoLoad)void run()},[autoLoad,reviewId])
 useEffect(()=>{onLockChange?.(busy||pending!==null)},[busy,pending,onLockChange])
 useEffect(()=>()=>onLockChange?.(false),[onLockChange])
 const next:Status=data?.current?.status==='open'?'acknowledged':data?.current?.status==='acknowledged'?'resolved':'open'
 const readOnly=account.role!=='owner' && next!=='open'
 const action=next==='acknowledged'?'Acknowledge escalation':next==='resolved'?'Resolve escalation':data?.current?'Reopen escalation':'Flag for human attention'
 async function run(save=false){
  if(active.current)return
  if(save&&!pending&&!note.trim()){setError('Enter a reason or action note.');return}
  const c=new AbortController();active.current=c;setBusy(true);setError('');const timer=window.setTimeout(()=>c.abort(),60000)
  try{
   const body=save?(pending??JSON.stringify({request_id:crypto.randomUUID(),previous_event_id:data?.current?.event_id??null,status:next,note:note.trim()})):undefined
   if(save)setPending(body!)
   const r=await apiFetch(`/api/fact-reviews/${reviewId}/redline`,{method:save?'POST':'GET',headers:save?{'Content-Type':'application/json'}:undefined,body,signal:c.signal,cache:'no-store'});const d:unknown=await r.json()
   if(!r.ok){if(save&&[403,404,409,422].includes(r.status))setPending(null);throw new Error(obj(d)&&typeof d.detail==='string'?d.detail:`REDLINE request failed (${r.status}).`)}
   if(!obj(d)||d.review_id!==reviewId||!(d.current===null||event(d.current))||!Array.isArray(d.history)||!d.history.every(event)||d.notification_status!=='in_app_only')throw new Error('Unexpected REDLINE response.')
   if(active.current!==c||c.signal.aborted)return
   setData(d as State);setNote('');setPending(null);if(save)window.dispatchEvent(new Event('sentinel-redline-changed'))
  }catch(e){if(active.current===c)setError(c.signal.aborted?'Request timed out. Reload REDLINE to check saved state, or retry the same update.':e instanceof Error?e.message:'REDLINE failed.')}
  finally{window.clearTimeout(timer);if(active.current===c){active.current=null;setBusy(false)}}
 }
 return <section aria-label="REDLINE escalation" style={{border:'1px solid #f87171',padding:14,marginTop:16,borderRadius:8}}>
  <h5>REDLINE · Human attention</h5><p className="hint">Track an escalation inside this demo app. External notifications and automatic safety decisions are not enabled.</p>
  <button className="secondary" disabled={busy} onClick={()=>run()}>{data?'Reload REDLINE':'Load REDLINE status'}</button>
  {error&&<p className="error" role="alert">{error}</p>}{busy&&<p role="status">Working…</p>}
  {data&&<><p><strong>Status: {data.current?.status??'Not escalated'}</strong></p>
   {!readOnly&&<><label>Reason / action taken<textarea style={{display:'block',width:'100%',boxSizing:'border-box'}} maxLength={2000} disabled={busy||pending!==null} value={note} onChange={e=>setNote(e.target.value)} placeholder={next==='resolved'?'Record what was checked or done, and why this escalation can be closed.':'Explain why attention is needed or how it was acknowledged.'}/></label>
   <button disabled={busy} onClick={()=>run(true)}>{pending?'Retry same update':action}</button>
   {pending&&<p className="hint">The submission is locked until confirmed. Reload to check saved state.</p>}
   </>}
   <details><summary>Escalation audit history ({data.history.length})</summary><ul>{data.history.map(e=><li key={e.event_id}><strong>{e.status}</strong> · {e.note} · {new Date(e.created_at).toLocaleString()} · Local demo</li>)}</ul></details>
   <p className="hint">Resolving an escalation records a human workflow decision; it does not certify that a machine is safe to operate.</p>
  </>}
 </section>
}

import { apiFetch } from './api'
import { useEffect, useRef, useState } from 'react'
import OperationalMemory from './OperationalMemory'
type Event = {event_id:string|null;machine_id:string|null;machine_name:string|null;machine_code:string|null;reason:string;created_at:string}
type Link = {review_id:string;current:Event;history:Event[]}
type Machine = {machine_id:string;name:string;code:string;department:string}
type Report = {report_id:string;attempt_id:string;attempt_number:number;facts:{reported_issue:string|null};reviewed_at:string;verified_transcript:string}
type Page = {machine_id:string;name:string;code:string;reports:Report[];has_more:boolean;offset:number}
const object=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null
const nullable=(v:unknown)=>v===null||typeof v==='string'
const event=(v:unknown):v is Event=>object(v)&&nullable(v.event_id)&&nullable(v.machine_id)&&nullable(v.machine_name)&&nullable(v.machine_code)&&typeof v.reason==='string'&&typeof v.created_at==='string'&&Number.isFinite(Date.parse(v.created_at))
export default function MachineLink({reviewId}:{reviewId:string}) {
 const [link,setLink]=useState<Link|null>(null),[machines,setMachines]=useState<Machine[]>([])
 const [machine,setMachine]=useState(''),[browse,setBrowse]=useState(''),[reason,setReason]=useState('')
 const [page,setPage]=useState<Page|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState<string|null>(null)
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function run(action:'load'|'save'|'history',offset=0) {
  if(active.current)return
  if(action==='save'&&!pending&&!reason.trim()){setError('Enter a reason for changing the machine link.');return}
  if(action==='history'&&!browse)return
  const c=new AbortController();active.current=c;setBusy(true);setError('')
  const timer=window.setTimeout(()=>c.abort(),60000)
  try {
   let body=pending
   if(action==='save'&&!body){body=JSON.stringify({request_id:crypto.randomUUID(),previous_event_id:link?.current.event_id??null,machine_id:machine||null,reason:reason.trim()});setPending(body)}
   const url=action==='history'?`/api/machines/${browse}/reports?limit=20&offset=${offset}`:`/api/fact-reviews/${reviewId}/machine-link`
   const r=await apiFetch(url,{method:action==='save'?'POST':'GET',headers:action==='save'?{'Content-Type':'application/json'}:undefined,body:action==='save'?body:undefined,signal:c.signal,cache:'no-store'})
   const d:unknown=await r.json()
   if(!r.ok)throw new Error(object(d)&&typeof d.detail==='string'?d.detail:`Request failed (${r.status}).`)
   if(active.current!==c||c.signal.aborted)return
   if(action==='history'){
    if(!object(d)||d.machine_id!==browse||d.offset!==offset||typeof d.name!=='string'||typeof d.code!=='string'||typeof d.has_more!=='boolean'||!Array.isArray(d.reports)||!d.reports.every(x=>object(x)&&typeof x.report_id==='string'&&typeof x.attempt_id==='string'&&typeof x.attempt_number==='number'&&object(x.facts)&&nullable(x.facts.reported_issue)&&typeof x.verified_transcript==='string'&&typeof x.reviewed_at==='string'))throw new Error('Unexpected machine history response.')
    setPage(d as Page)
   }else{
    if(!object(d)||d.review_id!==reviewId||!event(d.current)||!Array.isArray(d.history)||!d.history.every(event))throw new Error('Unexpected machine-link response.')
    const mr=await apiFetch('/api/machines',{signal:c.signal,cache:'no-store'});const md:unknown=await mr.json()
    if(!mr.ok||!object(md)||!Array.isArray(md.machines)||!md.machines.every(x=>object(x)&&['machine_id','name','code','department'].every(k=>typeof x[k]==='string')))throw new Error('Could not load machine choices.')
    if(active.current!==c||c.signal.aborted)return
    setLink(d as Link);setMachines(md.machines as Machine[]);setMachine(d.current.machine_id??'');setBrowse(d.current.machine_id??'');setReason('');setPending(null);setPage(null)
   }
  }catch(e){if(active.current===c)setError(c.signal.aborted?'Request timed out. Reload the link to check its saved state, or retry the same change.':e instanceof Error?e.message:'Request failed.')}
  finally{window.clearTimeout(timer);if(active.current===c){active.current=null;setBusy(false)}}
 }
 return <section aria-label="Machine linking and history">
  <h5>Current machine link and history</h5>
  <button className="secondary" disabled={busy} onClick={()=>run('load')}>{link?'Reload machine link':'Open machine linking'}</button>
  {error&&<p role="alert" className="error">{error}</p>}{busy&&<p role="status">Working…</p>}
  {link&&<>
   <p><strong>Current machine: {link.current.machine_name??'Unlinked / needs identification'}</strong></p>
   <fieldset disabled={busy||pending!==null} style={{border:0,padding:0,display:'grid',gap:8}}>
    <label>Choose machine<select style={{display:'block',width:'100%'}} value={machine} onChange={e=>setMachine(e.target.value)}><option value="">Unlinked / unsure</option>{machines.map(m=><option key={m.machine_id} value={m.machine_id}>{m.name} · {m.code}</option>)}</select></label>
    <label>Reason for change<input style={{display:'block',width:'100%',boxSizing:'border-box'}} value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)}/></label>
   </fieldset>
   <button disabled={busy} onClick={()=>run('save')}>{pending?'Retry same link change':'Save machine link change'}</button>
   {pending&&<p className="hint">The submitted values are locked until confirmed. Reload the machine link to check saved state.</p>}
   <details><summary>Machine link audit history ({link.history.length})</summary><ul>{link.history.map((e,i)=><li key={e.event_id??'original'}>{i===0?'Current · ':''}{e.machine_name??'Unlinked'} · {e.reason} · {new Date(e.created_at).toLocaleString()}</li>)}</ul></details>
   <OperationalMemory key={`${reviewId}:${link.current.event_id ?? 'original'}`} reviewId={reviewId} />
   <h5>Reports for a machine</h5>
   <label>Browse machine<select disabled={busy} style={{display:'block',width:'100%'}} value={browse} onChange={e=>{setBrowse(e.target.value);setPage(null)}}><option value="">Select a machine</option>{machines.map(m=><option key={m.machine_id} value={m.machine_id}>{m.name} · {m.department}</option>)}</select></label>
   <button className="secondary" disabled={busy||!browse} onClick={()=>run('history')}>Load machine reports</button>
   {page&&<><p>{page.name} · {page.code}</p>{page.reports.length===0?<p>No reviewed reports linked to this machine.</p>:page.reports.map(r=><article key={r.attempt_id} style={{borderTop:'1px solid #64748b',marginTop:12}}><p><strong>{r.facts.reported_issue??'Issue not reported'}</strong></p><p>{r.verified_transcript}</p><p className="hint">Report {r.report_id} · Attempt {r.attempt_number} · {new Date(r.reviewed_at).toLocaleString()}</p></article>)}<button className="secondary" disabled={busy||page.offset===0} onClick={()=>run('history',Math.max(0,page.offset-20))}>Previous</button><button className="secondary" disabled={busy||!page.has_more} onClick={()=>run('history',page.offset+20)}>Next</button></>}
  </>}
 </section>
}

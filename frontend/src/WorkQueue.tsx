import { useAccount } from './Auth'
import { apiFetch } from './api'
import { useEffect,useRef,useState } from 'react'
import RepairLog from './RepairLog'
type Task={event_id:string;review_id:string;status:string;action_note:string;outcome:string|null;created_at:string;technician_name:string;technician_id:string;assigned_machine_name:string;assigned_machine_code:string;report_id:string;reported_issue:string|null;current_machine_id:string|null;assigned_machine_id:string}
type Page={technicians:{technician_id:string;code:string;name:string}[];tasks:Task[];total:number;offset:number;has_more:boolean;status_filter:string;technician_filter:string|null}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'
const text=(v:unknown)=>v===null||typeof v==='string'
function valid(v:unknown,status:string,tech:string,offset:number):v is Page{
 return obj(v)&&v.status_filter===status&&v.technician_filter===(tech||null)&&v.offset===offset&&v.limit===20&&typeof v.total==='number'&&Number.isSafeInteger(v.total)&&v.total>=0&&typeof v.has_more==='boolean'&&Array.isArray(v.technicians)&&v.technicians.every(t=>obj(t)&&['technician_id','name','code'].every(k=>typeof t[k]==='string'))&&Array.isArray(v.tasks)&&v.tasks.length<=20&&v.has_more===(offset+v.tasks.length<v.total)&&v.tasks.every(t=>obj(t)&&['event_id','review_id','action_note','created_at','technician_name','technician_id','assigned_machine_name','assigned_machine_code','report_id','assigned_machine_id'].every(k=>typeof t[k]==='string')&&['assigned','in_progress','completed'].includes(t.status as string)&&text(t.outcome)&&text(t.reported_issue)&&text(t.current_machine_id))
}
export default function WorkQueue(){
 const account=useAccount()
 const [data,setData]=useState<Page|null>(null),[status,setStatus]=useState('active'),[tech,setTech]=useState(account.technician_id??''),[selected,setSelected]=useState<Task|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function load(offset=0){
  if(active.current)return
  const c=new AbortController();active.current=c;setBusy(true);setError('');const timer=window.setTimeout(()=>c.abort(),30000)
  try{
   const params=new URLSearchParams({status,offset:String(offset)});if(tech)params.set('technician_id',tech)
   const r=await apiFetch(`/api/work-queue?${params}`,{signal:c.signal,cache:'no-store'});const d:unknown=await r.json()
   if(!r.ok)throw new Error(obj(d)&&typeof d.detail==='string'?d.detail:`Queue failed (${r.status}).`)
   if(!valid(d,status,tech,offset))throw new Error('Unexpected queue response.')
   if(active.current===c&&!c.signal.aborted)setData(d)
  }catch(e){if(active.current===c)setError(c.signal.aborted?'Queue timed out. You can safely refresh.':e instanceof Error?e.message:'Could not load queue.')}
  finally{window.clearTimeout(timer);if(active.current===c){active.current=null;setBusy(false)}}
 }
 return <section className="card technician-workspace" aria-labelledby="work-queue-heading" style={{margin:'24px 0'}}>
  <p className="eyebrow">TECHNICIAN WORK QUEUE · LOCAL DEMO</p><h2 id="work-queue-heading">Assigned work</h2>
  <p className="hint">View the latest assignment for each reviewed report. Owners can filter by technician. Technician accounts can access only their own assigned work.</p>
  <div className="queue-filter-bar">
   <label>Technician<select disabled={busy} value={tech} onChange={e=>setTech(e.target.value)}><option value="">All technicians</option>{data?.technicians.map(t=><option key={t.technician_id} value={t.technician_id}>{t.name}</option>)}</select></label>
   <label>Work status<select disabled={busy} value={status} onChange={e=>setStatus(e.target.value)}><option value="active">Active work</option><option value="completed">Completed work</option><option value="all">All work</option></select></label>
  </div>
  <button className="secondary" disabled={busy} onClick={()=>load()}>{busy?'Loading…':'Load / refresh work queue'}</button>
  {error&&<p className="error" role="alert">{error}</p>}{busy&&<div className="workspace-loading" role="status"><span className="loading-dot"/>Loading your assignments…<div className="loading-placeholder"/></div>}
  {!data&&!busy&&!error&&<div className="workspace-empty"><span aria-hidden="true">↗</span><h3>Your next task starts here</h3><p>Load your queue to see assigned machines, reported issues and repair progress.</p></div>}
  {data&&data.status_filter===status&&data.technician_filter===(tech||null)&&<>
   <div className="queue-summary"><strong>{data.total}</strong><div><b>{data.status_filter==='active'?'Active assignments':data.status_filter==='completed'?'Completed assignments':'Matching assignments'}</b><p>Refresh the queue after saving a work update.</p></div></div>
   {!data.tasks.length&&<div className="workspace-empty"><span aria-hidden="true">✓</span><h3>No assignments in this view</h3><p>Completed tasks are available under Completed work. Refresh to check for saved changes.</p></div>}
   {data.tasks.map(t=><article className={`technician-task task-${t.status}`} key={t.review_id}>
    <div className="task-heading"><h3>{t.assigned_machine_name}<small>{t.assigned_machine_code}</small></h3><span className={`work-status work-status-${t.status==='in_progress'?'live':t.status==='completed'?'done':'new'}`}>{t.status==='in_progress'?'In progress':t.status==='completed'?'Completed':'Assigned'}</span></div><p className="task-issue">{t.reported_issue??'Issue not reported'}</p><p className="task-technician">Assigned to <strong>{t.technician_name}</strong></p>{t.action_note&&<p className="task-note">{t.action_note}</p>}
    {t.outcome&&<p>Reported outcome: {t.outcome.replaceAll('_',' ')}</p>}
    {t.assigned_machine_id!==t.current_machine_id&&<p className="error">The report's current machine link differs from this work record. Check the link and save a new assignment before progressing work.</p>}
    <p className="hint">Updated {new Date(t.created_at).toLocaleString()} · Report {t.report_id}</p>
    <button className="secondary" disabled={busy||selected!==null} onClick={()=>setSelected(t)}>{t.status==='completed'?'View completed work':'Open repair log & update'}</button>
   </article>)}
   <div style={{display:'flex',gap:12,marginTop:12}}><button className="secondary" disabled={busy||data.offset===0} onClick={()=>load(Math.max(0,data.offset-20))}>Previous tasks</button><button className="secondary" disabled={busy||!data.has_more} onClick={()=>load(data.offset+20)}>Next tasks</button></div>
  </>}
  {selected&&<div className="selected-repair-panel"><div className="selected-repair-heading"><p className="eyebrow">REPAIR WORKSPACE</p><h3>{selected.assigned_machine_name}</h3><p>{selected.assigned_machine_code}</p><p className="hint">Report: {selected.report_id}</p></div><p className="hint">Finish or confirm any pending save before closing this panel.</p><button className="secondary" onClick={()=>setSelected(null)}>Close selected repair log</button><RepairLog key={selected.review_id} reviewId={selected.review_id}/></div>}
 </section>
}

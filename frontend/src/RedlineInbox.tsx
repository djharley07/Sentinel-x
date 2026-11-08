import { useEffect,useRef,useState } from 'react'
import { apiFetch } from './api'
import Redline from './Redline'
import { isHistoryReport } from './ReportHistory'
import './RedlineInbox.css'

type Counts={open:number;acknowledged:number;resolved:number;active:number;active_reports:number;total:number}
type Summary={counts:Counts;checked_at:string;notification_status:'in_app_only'}
type Case={review_id:string;report_id:string;attempt_id:string;attempt_number:number;latest_attempt_number:number;event_id:string;status:'open'|'acknowledged'|'resolved';note:string;updated_at:string;machine_id:string|null;machine_name:string|null;machine_code:string|null;department:string|null;machine_active:boolean|null;reported_issue:string|null;equipment_label:string|null}
type Page=Summary&{cases:Case[];status:string;offset:number;limit:number;has_more:boolean}
type Detail={case:Case;facts:Record<string,unknown>;facts_reviewed_at:string;original_transcript:string;verified_transcript:string|null}
type ReportSnapshot={report_id:string;attempts:{attempt_id:string;attempt_number:number;original_transcript:string;verified_transcript:string|null;verification_status:string}[]}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'
const number=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0
const nullable=(v:unknown)=>v===null||typeof v==='string'
const date=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v)
function counts(v:unknown):v is Counts{return obj(v)&&['open','acknowledged','resolved','active','active_reports','total'].every(k=>number(v[k]))&&v.active===(v.open as number)+(v.acknowledged as number)&&v.total===(v.active as number)+(v.resolved as number)&&(v.active_reports as number)<=(v.active as number)}
function summary(v:unknown):v is Summary{return obj(v)&&counts(v.counts)&&date(v.checked_at)&&v.notification_status==='in_app_only'}
function validCase(v:unknown):v is Case{return obj(v)&&['review_id','report_id','attempt_id','event_id'].every(k=>uuid(v[k]))&&(v.machine_id===null||uuid(v.machine_id))&&['machine_name','machine_code','department','reported_issue','equipment_label'].every(k=>nullable(v[k]))&&(v.machine_active===null||typeof v.machine_active==='boolean')&&number(v.attempt_number)&&(v.attempt_number as number)>0&&number(v.latest_attempt_number)&&(v.latest_attempt_number as number)>=(v.attempt_number as number)&&['open','acknowledged','resolved'].includes(String(v.status))&&typeof v.note==='string'&&date(v.updated_at)}
const message=(v:unknown,status:number)=>obj(v)&&typeof v.detail==='string'?v.detail:`REDLINE request failed (${status}).`
const when=(s:string)=>new Date(s).toLocaleString()

// Refreshes read-only snapshots. Background tabs and hidden inbox views do not poll.
function useOwnerRefresh(active:boolean,callback:()=>void,key=''){
 const current=useRef(callback);current.current=callback
 useEffect(()=>{
  if(!active)return
  const refresh=()=>{if(document.visibilityState!=='hidden')current.current()}
  refresh();const timer=window.setInterval(refresh,60000)
  window.addEventListener('focus',refresh);window.addEventListener('sentinel-redline-changed',refresh);document.addEventListener('visibilitychange',refresh)
  return()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('sentinel-redline-changed',refresh);document.removeEventListener('visibilitychange',refresh)}
 },[active,key])
}

export function OwnerRedlineBanner({onOpen}:{onOpen:()=>void}){
 const [data,setData]=useState<Summary|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const control=useRef<AbortController|null>(null)
 useEffect(()=>()=>{control.current?.abort();control.current=null},[])
 async function refresh(){
  if(control.current)return
  const c=new AbortController();control.current=c;setBusy(true);const timer=window.setTimeout(()=>c.abort(),20000)
  try{
   const r=await apiFetch('/api/redline-alerts/summary',{signal:c.signal});const d:unknown=await r.json()
   if(!r.ok)throw new Error(message(d,r.status))
   if(!summary(d))throw new Error('Unexpected REDLINE summary.')
   if(control.current===c&&!c.signal.aborted){setData(d);setError('')}
  }catch(e){if(control.current===c)setError(c.signal.aborted?'REDLINE refresh timed out.':e instanceof Error?e.message:'Could not check REDLINE.')}
  finally{window.clearTimeout(timer);if(control.current===c){control.current=null;setBusy(false)}}
 }
 useOwnerRefresh(true,()=>void refresh())
 const active=(data?.counts.active??0)>0
 return <aside className={`owner-redline-banner ${active?'owner-redline-active':error?'owner-redline-unknown':''}`} aria-label="Owner REDLINE alert status">
  <div aria-live="polite"><strong>{active?`REDLINE · ${data!.counts.active} active escalation${data!.counts.active===1?'':'s'}`:error?'REDLINE status unavailable':data?'REDLINE · No active escalations in the last check':'Checking REDLINE status…'}</strong>
   {data&&<p>{data.counts.open} open · {data.counts.acknowledged} acknowledged · {data.counts.active_reports} affected reports</p>}
   {error&&<p className="redline-refresh-error">{error} {data?'Counts shown are from the previous successful check.':'Current status is unknown.'}</p>}
   <p className="hint">{data?`Last successful check: ${when(data.checked_at)}. `:''}Manual in-app escalations. Refreshes every minute while this tab is visible; no external alerts or automatic fault detection.</p>
  </div>
  <div className="redline-inbox-actions"><button type="button" onClick={onOpen}>Open REDLINE inbox</button><button type="button" className="secondary" disabled={busy} onClick={refresh}>{busy?'Checking…':'Refresh alerts'}</button></div>
 </aside>
}

export function RedlineInbox({active}:{active:boolean}){
 const [filter,setFilter]=useState('active'),[offset,setOffset]=useState(0),[page,setPage]=useState<Page|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const [selected,setSelected]=useState<Detail|null>(null),[detailBusy,setDetailBusy]=useState(false),[detailError,setDetailError]=useState(''),[editorLocked,setEditorLocked]=useState(false)
 const [report,setReport]=useState<ReportSnapshot|null>(null),[reportBusy,setReportBusy]=useState(false),[reportError,setReportError]=useState('')
 const listControl=useRef<AbortController|null>(null),detailControl=useRef<AbortController|null>(null),reportControl=useRef<AbortController|null>(null)
 useEffect(()=>()=>{for(const c of [listControl,detailControl,reportControl]){c.current?.abort();c.current=null}},[])
 async function load(){
  if(listControl.current)return
  const c=new AbortController();listControl.current=c;setBusy(true);const timer=window.setTimeout(()=>c.abort(),20000)
  try{
   const r=await apiFetch(`/api/redline-alerts?status=${filter}&offset=${offset}&limit=20`,{signal:c.signal});const d:unknown=await r.json()
   if(!r.ok)throw new Error(message(d,r.status))
   if(!obj(d)||!Array.isArray(d.cases)||!d.cases.every(validCase)||d.status!==filter||d.offset!==offset||d.limit!==20||typeof d.has_more!=='boolean'||!summary(d))throw new Error('Unexpected REDLINE inbox response.')
   if(listControl.current===c&&!c.signal.aborted){setPage(d as Page);setError('')}
  }catch(e){if(listControl.current===c)setError(c.signal.aborted?'Inbox refresh timed out.':e instanceof Error?e.message:'Could not load escalations.')}
  finally{window.clearTimeout(timer);if(listControl.current===c){listControl.current=null;setBusy(false)}}
 }
 useOwnerRefresh(active,()=>void load(),`${filter}:${offset}`)
 async function openCase(reviewId:string){
  if(editorLocked||detailControl.current)return
  reportControl.current?.abort();reportControl.current=null;setReport(null);setReportError('');setReportBusy(false)
  const c=new AbortController();detailControl.current=c;setDetailBusy(true);setDetailError('');setSelected(null)
  const timer=window.setTimeout(()=>c.abort(),20000)
  try{
   const r=await apiFetch(`/api/redline-alerts/${reviewId}`,{signal:c.signal});const d:unknown=await r.json()
   if(!r.ok)throw new Error(message(d,r.status))
   if(!obj(d)||!validCase(d.case)||d.case.review_id!==reviewId||!obj(d.facts)||!date(d.facts_reviewed_at)||typeof d.original_transcript!=='string'||!nullable(d.verified_transcript)||d.notification_status!=='in_app_only')throw new Error('Unexpected escalation source response.')
   if(detailControl.current===c&&!c.signal.aborted)setSelected(d as Detail)
  }catch(e){if(detailControl.current===c)setDetailError(c.signal.aborted?'Escalation source loading timed out.':e instanceof Error?e.message:'Could not open escalation.')}
  finally{window.clearTimeout(timer);if(detailControl.current===c){detailControl.current=null;setDetailBusy(false)}}
 }
 async function openReport(){
  if(!selected||reportControl.current)return
  const reportId=selected.case.report_id,c=new AbortController();reportControl.current=c;setReportBusy(true);setReportError('');const timer=window.setTimeout(()=>c.abort(),30000)
  try{
   const r=await apiFetch(`/api/reports/${reportId}`,{signal:c.signal});const d:unknown=await r.json()
   if(!r.ok)throw new Error(message(d,r.status))
   if(!isHistoryReport(d,reportId))throw new Error('Unexpected report history response.')
   if(reportControl.current===c&&!c.signal.aborted)setReport(d)
  }catch(e){if(reportControl.current===c)setReportError(c.signal.aborted?'Report loading timed out.':e instanceof Error?e.message:'Could not load report versions.')}
  finally{window.clearTimeout(timer);if(reportControl.current===c){reportControl.current=null;setReportBusy(false)}}
 }
 return <section className="card redline-inbox" aria-labelledby="redline-inbox-heading"><p className="eyebrow">OWNER WORKSPACE / MANUAL ESCALATIONS</p><h2 id="redline-inbox-heading">REDLINE inbox</h2>
  <p>Open and acknowledged cases remain active until an owner resolves them. Corrections and technician work completion do not close an earlier escalation.</p>
  <p className="hint">Each case belongs to a human fact review and its source transcript version. A report can have more than one case across versions. Machine labels reflect current directory details. This inbox sends no external notification and makes no machine safety decision.</p>
  <div className="redline-inbox-actions"><label>Show cases<select value={filter} disabled={busy} onChange={e=>{setFilter(e.target.value);setOffset(0);setPage(null)}}><option value="active">Active: open and acknowledged</option><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option><option value="all">All cases</option></select></label><button type="button" className="secondary" disabled={busy} onClick={load}>{busy?'Refreshing…':'Refresh inbox'}</button></div>
  {error&&<p role="alert" className="error">{error} {page?'The list below is from the previous successful refresh.':'Current case list is unavailable.'}</p>}
  {page&&<><p>{page.counts.open} open · {page.counts.acknowledged} acknowledged · {page.counts.resolved} resolved</p><p className="hint">List checked {when(page.checked_at)}. Refreshing this list keeps the current case editor open.</p>
   {page.cases.length===0?<p>No cases match this page and filter.</p>:<div className="redline-inbox-table"><table><thead><tr><th>Machine / reported issue</th><th>State</th><th>Source version</th><th>Last update</th><th>Case</th></tr></thead><tbody>{page.cases.map(c=><tr key={c.review_id}><td><strong>{c.machine_name??c.equipment_label??'Unlinked report'}</strong><p>{c.machine_code??'No current machine link'}{c.machine_active===false?' · Directory inactive':''}</p><p>{c.reported_issue??'Issue not recorded'}</p></td><td><span className={`redline-case-status redline-case-${c.status}`}>{c.status==='open'?'Open · Unacknowledged':c.status==='acknowledged'?'Acknowledged · Active':'Resolved'}</span></td><td>{c.attempt_number}{c.attempt_number<c.latest_attempt_number?` · Earlier than latest version ${c.latest_attempt_number}`:' · Latest version'}</td><td>{when(c.updated_at)}</td><td><button type="button" className="secondary" disabled={detailBusy||editorLocked} onClick={()=>openCase(c.review_id)}>Open escalation</button></td></tr>)}</tbody></table></div>}
   <div className="redline-inbox-actions"><button type="button" className="secondary" disabled={busy||offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>Previous cases</button><button type="button" className="secondary" disabled={busy||!page.has_more} onClick={()=>setOffset(offset+20)}>Next cases</button></div></>}
  {detailBusy&&<p role="status">Loading escalation source…</p>}{detailError&&<p role="alert" className="error">{detailError} Select the case again to retry.</p>}
  {selected&&<article className="redline-inbox-detail"><h3>{selected.case.machine_name??selected.case.equipment_label??'Unlinked report'} · source version {selected.case.attempt_number}</h3>
   <p className="hint">Report {selected.case.report_id} · Fact review {selected.case.review_id} · Facts reviewed {when(selected.facts_reviewed_at)}</p>
   {selected.case.attempt_number<selected.case.latest_attempt_number&&<p className="redline-version-warning">This escalation belongs to an earlier report version. It remains active until explicitly resolved; inspect the newer versions before deciding what to do.</p>}
   <h4>Human-reviewed facts for this case</h4><dl>{[['equipment_label','Reported equipment'],['reported_issue','Reported issue'],['temperature_value','Temperature value'],['temperature_unit','Temperature unit'],['issue_started_at','Issue started']].map(([key,label])=><div key={key}><dt>{label}</dt><dd>{typeof selected.facts[key]==='string'||typeof selected.facts[key]==='number'?String(selected.facts[key]):'Not recorded'}</dd></div>)}</dl>
   <h4>Confirmed transcript for the source version</h4><p className="redline-source-text">{selected.verified_transcript??'No confirmed transcript is available for this source version.'}</p><details><summary>Original transcription for this source version</summary><p className="redline-source-text">{selected.original_transcript}</p></details>
   <Redline key={selected.case.review_id} reviewId={selected.case.review_id} autoLoad onLockChange={setEditorLocked}/>
   <button type="button" className="secondary" disabled={reportBusy} onClick={openReport}>{reportBusy?'Loading report versions…':'Open all report versions (read-only)'}</button>
   {reportError&&<p role="alert" className="error">{reportError}</p>}
   {report&&<details open><summary>Report versions · {report.attempts.length}</summary>{report.attempts.map(a=><section className="redline-report-version" key={a.attempt_id}><h4>Version {a.attempt_number} · {a.verification_status}{a.attempt_id===selected.case.attempt_id?' · This case source':''}</h4><p className="redline-source-text">{a.verified_transcript??a.original_transcript}</p></section>)}</details>}
  </article>}
 </section>
}

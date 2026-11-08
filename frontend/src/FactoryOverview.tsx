import { apiFetch } from './api'
import { useEffect,useRef,useState } from 'react'
import './FactoryOverview.css'
type Data={organization_name:string;counts:Record<string,number>;machines:{machine_id:string;code:string;name:string;department:string;report_count:number;active_redlines:number}[];active_redlines:{review_id:string;report_id:string;reported_issue:string|null;redline_status:string;note:string;updated_at:string;machine_name:string|null;machine_code:string|null}[];redline_offset:number;redline_has_more:boolean;recent_reports:{report_id:string;created_at:string;attempt_number:number|null;original_transcript:string|null;verification_status:string}[]}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0
const nullable=(v:unknown)=>v===null||typeof v==='string'
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))
const countLabels:Record<string,string>={total_reports:'Saved reports',pending_transcripts:'Transcript reviews needed',rerecord_requested:'Re-recordings requested',reviewed_reports:'Reports with reviewed facts',active_redlines:'Active REDLINE cases',unlinked_reviews:'Unlinked fact reviews'}
function valid(v:unknown,offset:number):v is Data{
 return obj(v)&&typeof v.organization_name==='string'&&obj(v.counts)&&Object.keys(countLabels).every(k=>integer((v.counts as Record<string,unknown>)[k]))&&v.redline_offset===offset&&typeof v.redline_has_more==='boolean'&&
 Array.isArray(v.machines)&&v.machines.every(m=>obj(m)&&['machine_id','code','name','department'].every(k=>typeof m[k]==='string')&&integer(m.report_count)&&integer(m.active_redlines))&&
 Array.isArray(v.active_redlines)&&v.active_redlines.every(r=>obj(r)&&typeof r.review_id==='string'&&typeof r.report_id==='string'&&nullable(r.reported_issue)&&['open','acknowledged'].includes(r.redline_status as string)&&typeof r.note==='string'&&date(r.updated_at)&&nullable(r.machine_name)&&nullable(r.machine_code))&&
 Array.isArray(v.recent_reports)&&v.recent_reports.every(r=>obj(r)&&typeof r.report_id==='string'&&date(r.created_at)&&(r.attempt_number===null||integer(r.attempt_number))&&nullable(r.original_transcript)&&['pending','accepted','corrected','rerecord_requested'].includes(r.verification_status as string))
}
export default function FactoryOverview({active:visible=true}:{active?:boolean}){
 const [data,setData]=useState<Data|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function load(offset=0){
  if(active.current)return
  const c=new AbortController();active.current=c;setBusy(true);setError('');const timer=window.setTimeout(()=>c.abort(),30000)
  try{const r=await apiFetch(`/api/overview?offset=${offset}`,{signal:c.signal,cache:'no-store'});const d:unknown=await r.json()
   if(!r.ok)throw new Error(obj(d)&&typeof d.detail==='string'?d.detail:`Overview failed (${r.status}).`)
   if(!valid(d,offset))throw new Error('Unexpected overview response.')
   if(active.current===c&&!c.signal.aborted)setData(d)
  }catch(e){if(active.current===c)setError(c.signal.aborted?'Overview timed out. You can safely refresh.':e instanceof Error?e.message:'Could not load overview.')}
  finally{window.clearTimeout(timer);if(active.current===c){active.current=null;setBusy(false)}}
 }
 useEffect(()=>{if(visible)void load()},[visible])
 return <section className="factory-overview card" aria-labelledby="overview-heading">
  <p className="eyebrow">FACTORY OVERVIEW · LOCAL DEMO</p><h2 id="overview-heading">Factory overview</h2>
  <button className="secondary" disabled={busy} onClick={()=>load()}>{busy?'Loading…':data?'Refresh overview':'Load factory overview'}</button>
  <p className="hint">Refresh after saving work. Active REDLINE means open or acknowledged; a resolved escalation does not certify machine safety.</p>
  {error&&<p className="error" role="alert">{error}{data?' The displayed overview is from the previous successful load.':''}</p>}
  {busy&&<div className="workspace-loading" role="status"><span className="loading-dot"/>Loading saved factory data…{!data&&<div className="metric-skeletons">{[1,2,3,4,5,6].map(n=><div className="loading-placeholder" key={n}/>)}</div>}</div>}
  {data&&<><h3>{data.organization_name}</h3><div className="overview-counts">{Object.entries(countLabels).map(([k,label])=><div className={`overview-metric metric-${k}`} key={k}><span className="metric-label">{label}</span><strong>{data.counts[k]}</strong><small>{k==='active_redlines'?'Open or acknowledged':'Saved factory records'}</small></div>)}</div>
   <h3>Active REDLINE cases</h3>{data.active_redlines.length===0?<div className="workspace-empty compact-empty"><h4>{data.counts.active_redlines===0?'No active REDLINE cases':'No cases on this page'}</h4><p>{data.counts.active_redlines===0?'No open or acknowledged escalations in this saved overview.':'Refresh the overview to return to the first page.'}</p></div>:data.active_redlines.map(r=><article className="overview-case" key={r.review_id}>
    <p><strong>{r.redline_status.toUpperCase()} · {r.machine_name??'Unlinked machine'}</strong></p><p>{r.reported_issue??'Issue not reported'}</p><p>{r.note}</p><p className="hint">Updated {new Date(r.updated_at).toLocaleString()} · Report {r.report_id}</p>
   </article>)}
   <div className="overview-actions"><button className="secondary" disabled={busy||data.redline_offset===0} onClick={()=>load(Math.max(0,data.redline_offset-20))}>Previous cases</button><button className="secondary" disabled={busy||!data.redline_has_more} onClick={()=>load(data.redline_offset+20)}>Next cases</button></div>
   <h3>Machines ({data.machines.length})</h3><div className="overview-table"><table><thead><tr><th>Machine</th><th>Department</th><th>Linked reviewed reports</th><th>Active REDLINE reports</th></tr></thead><tbody>{data.machines.map(m=><tr key={m.machine_id}><td>{m.name}<br/><small>{m.code}</small></td><td>{m.department}</td><td>{m.report_count}</td><td>{m.active_redlines}</td></tr>)}</tbody></table></div>
   {!data.machines.length&&<p>No machines configured.</p>}
   <h3>Recent reports · Latest 10</h3>{!data.recent_reports.length&&<p>No saved reports yet.</p>}{data.recent_reports.map(r=><article className="overview-case" key={r.report_id}><p><strong>{r.verification_status.replaceAll('_',' ')}</strong> · Attempt {r.attempt_number??'—'}</p><p>{r.original_transcript??'No transcription saved'}</p><p className="hint">{new Date(r.created_at).toLocaleString()} · Report {r.report_id}</p></article>)}
   <p className="hint">Use Report history below to open reports and update reviews or REDLINE status. This overview is read-only.</p>
  </>}
 </section>
}

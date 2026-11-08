import { useEffect,useRef,useState } from 'react'
import { apiFetch } from './api'
import './MaintenanceAnalytics.css'
type Counts={total_reports:number;reviewed_reports:number;linked_reports:number;unlinked_reports:number;without_reviewed_facts:number;no_recorded_work:number;assigned_work:number;in_progress_work:number;completed_work:number;work_machine_mismatches:number}
type Data={days:number;counts:Counts;method:string;machines:{machine_id:string;code:string;name:string;department:string;report_count:number;last_reported_at:string|null}[];departments:{department:string|null;report_count:number;machines_with_reports:number}[];
 repeated_issues:{machine_id:string;machine_name:string;machine_code:string;department:string;reported_issue:string;issue_example:string;report_count:number;last_reported_at:string}[];issue_offset:number;issue_has_more:boolean;issue_total:number;
 outcomes:{outcome:string;report_count:number}[];technicians:{technician_id:string;technician_name:string;assigned:number;in_progress:number;completed:number}[];submitters:{account_id:string|null;username:string|null;display_name:string|null;report_count:number}[]}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0
const nullableText=(v:unknown)=>v===null||typeof v==='string'
const strings=(v:unknown,keys:string[])=>object(v)&&keys.every(k=>typeof v[k]==='string')
const countKeys=['total_reports','reviewed_reports','linked_reports','unlinked_reports','without_reviewed_facts','no_recorded_work','assigned_work','in_progress_work','completed_work','work_machine_mismatches']
function valid(v:unknown,days:number,offset:number):v is Data{
 if(!object(v)||v.days!==days||!object(v.counts)||!countKeys.every(k=>integer((v.counts as Record<string,unknown>)[k]))||typeof v.method!=='string')return false
 const c=v.counts as Counts
 return c.total_reports===c.reviewed_reports+c.without_reviewed_facts&&c.reviewed_reports===c.linked_reports+c.unlinked_reports&&c.reviewed_reports===c.no_recorded_work+c.assigned_work+c.in_progress_work+c.completed_work&&
  Array.isArray(v.machines)&&v.machines.every(m=>strings(m,['machine_id','code','name','department'])&&object(m)&&integer(m.report_count)&&nullableText(m.last_reported_at))&&
  Array.isArray(v.departments)&&v.departments.every(d=>object(d)&&nullableText(d.department)&&integer(d.report_count)&&integer(d.machines_with_reports))&&
  Array.isArray(v.repeated_issues)&&v.repeated_issues.length<=20&&v.repeated_issues.every(i=>strings(i,['machine_id','machine_name','machine_code','department','reported_issue','issue_example','last_reported_at'])&&object(i)&&integer(i.report_count)&&(i.report_count as number)>=2)&&
  v.issue_offset===offset&&integer(v.issue_total)&&v.issue_has_more===(offset+v.repeated_issues.length<(v.issue_total as number))&&
  Array.isArray(v.outcomes)&&v.outcomes.every(o=>object(o)&&['resolved','improved','unresolved','not_checked'].includes(o.outcome as string)&&integer(o.report_count))&&
  Array.isArray(v.technicians)&&v.technicians.every(t=>strings(t,['technician_id','technician_name'])&&object(t)&&['assigned','in_progress','completed'].every(k=>integer(t[k])))&&
  Array.isArray(v.submitters)&&v.submitters.every(s=>object(s)&&['account_id','username','display_name'].every(k=>nullableText(s[k]))&&integer(s.report_count))
}
const date=(value:string|null)=>value?new Date(value).toLocaleString():'No reviewed report'
export default function MaintenanceAnalytics(){
 const [days,setDays]=useState(0),[data,setData]=useState<Data|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function load(offset=0){
  if(active.current)return
  const c=new AbortController();active.current=c;setBusy(true);setError('');const timer=window.setTimeout(()=>c.abort(),60000)
  try{
   const r=await apiFetch(`/api/analytics?days=${days}&issue_offset=${offset}`,{signal:c.signal});const d:unknown=await r.json()
   if(!r.ok)throw new Error(object(d)&&typeof d.detail==='string'?d.detail:`Analytics failed (${r.status}).`)
   if(!valid(d,days,offset))throw new Error('Unexpected analytics response. Refresh after checking the backend.')
   if(active.current===c)setData(d)
  }catch(e){if(active.current===c)setError(c.signal.aborted?'Analytics timed out. Try again.':e instanceof Error?e.message:'Could not load analytics.')}
  finally{window.clearTimeout(timer);if(active.current===c){active.current=null;setBusy(false)}}
 }
 return <section className="card maintenance-analytics"><p className="eyebrow">OWNER WORKSPACE / REPORTED MAINTENANCE</p><h2>Maintenance analytics</h2>
  <p>Explore reviewed reports and recorded work. Repeated wording suggests reports to investigate; it does not establish the same fault, successful repair or worker performance.</p>
  <label>Report creation window<select disabled={busy} value={days} onChange={e=>{setDays(Number(e.target.value));setData(null)}}><option value={0}>All time</option><option value={7}>Past 7 days</option><option value={30}>Past 30 days</option><option value={90}>Past 90 days</option></select></label>
  <button className="secondary" disabled={busy} onClick={()=>load()}>{busy?'Loading…':data?'Refresh analytics':'Load analytics'}</button>
  {error&&<p className="error" role="alert">{error}</p>}
  {data&&<>
   <div className="analytics-counts">{([
    ['Saved reports',data.counts.total_reports],['Reports with reviewed facts',data.counts.reviewed_reports],['Without reviewed facts',data.counts.without_reviewed_facts],['Linked reviewed reports',data.counts.linked_reports],['Unlinked reviewed reports',data.counts.unlinked_reports],['Repeated wording groups',data.issue_total]
   ] as [string,number][]).map(([label,value])=><div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
   <p className="hint">All tables below use one latest human fact review per report. Older attempts and duplicate audit events do not add report counts. Newer pending attempts do not erase earlier reviewed facts.</p>
   <h3>Reviewed reports by current machine</h3><div className="analytics-table"><table><thead><tr><th>Machine</th><th>Department</th><th>Reports</th><th>Latest report created</th></tr></thead><tbody>{data.machines.map(m=><tr key={m.machine_id}><td>{m.name}<small>{m.code}</small></td><td>{m.department}</td><td>{m.report_count}</td><td>{date(m.last_reported_at)}</td></tr>)}</tbody></table></div>
   <h3>Reviewed reports by current department</h3>{data.departments.length?<div className="analytics-table"><table><thead><tr><th>Department</th><th>Reports</th><th>Machines with reports</th></tr></thead><tbody>{data.departments.map(d=><tr key={d.department??'unlinked'}><td>{d.department??'Unlinked / unidentified'}</td><td>{d.report_count}</td><td>{d.machines_with_reports}</td></tr>)}</tbody></table></div>:<p>No reviewed facts in this window.</p>}
   <h3>Repeated issue wording on the same machine</h3><p className="hint">Matches ignore letter case and repeated whitespace only. “Not leaking” stays separate from “leaking.” Punctuation, word order and language differences can produce separate groups.</p>
   {data.repeated_issues.length?<div className="analytics-table"><table><thead><tr><th>Machine</th><th>Example reported wording</th><th>Reports</th><th>Latest report created</th></tr></thead><tbody>{data.repeated_issues.map(i=><tr key={`${i.machine_id}:${i.reported_issue}`}><td>{i.machine_name}<small>{i.machine_code}</small></td><td>{i.issue_example}</td><td>{i.report_count}</td><td>{date(i.last_reported_at)}</td></tr>)}</tbody></table></div>:<p>No repeated wording groups in this window. This does not establish that no recurring faults exist.</p>}
   <div className="analytics-paging"><button className="secondary" disabled={busy||data.issue_offset===0} onClick={()=>load(Math.max(0,data.issue_offset-20))}>Previous groups</button><button className="secondary" disabled={busy||!data.issue_has_more} onClick={()=>load(data.issue_offset+20)}>Next groups</button></div>
   <h3>Latest recorded work per reviewed report</h3><p>No recorded work: <strong>{data.counts.no_recorded_work}</strong> · Assigned: <strong>{data.counts.assigned_work}</strong> · In progress: <strong>{data.counts.in_progress_work}</strong> · Completed: <strong>{data.counts.completed_work}</strong></p>
   <p className="hint">Completed is a workflow status. Outcomes below are human-reported and are not independently verified.</p>
   <div className="analytics-table"><table><thead><tr><th>Reported outcome on completed work</th><th>Reports</th></tr></thead><tbody>{[['resolved','Reported resolved'],['improved','Reported improved'],['unresolved','Reported unresolved'],['not_checked','Not checked']].map(([key,label])=><tr key={key}><td>{label}</td><td>{data.outcomes.find(o=>o.outcome===key)?.report_count??0}</td></tr>)}</tbody></table></div>
   {data.counts.work_machine_mismatches>0&&<p>{data.counts.work_machine_mismatches} work records refer to a different machine than the current report link, or to a report now unlinked. Their outcomes are retained as report history.</p>}
   <h3>Latest work by technician</h3>{data.technicians.length?<div className="analytics-table"><table><thead><tr><th>Technician</th><th>Assigned</th><th>In progress</th><th>Completed</th></tr></thead><tbody>{data.technicians.map(t=><tr key={t.technician_id}><td>{t.technician_name}</td><td>{t.assigned}</td><td>{t.in_progress}</td><td>{t.completed}</td></tr>)}</tbody></table></div>:<p>No work records on the selected reviewed reports.</p>}
   <h3>Reviewed reports by submitting account</h3>{data.submitters.length?<div className="analytics-table"><table><thead><tr><th>Submitting account</th><th>Reviewed reports</th></tr></thead><tbody>{data.submitters.map(s=><tr key={s.account_id??'legacy'}><td>{s.display_name??'Legacy demo · Submitter not recorded'}{s.username&&<small>{s.username}</small>}</td><td>{s.report_count}</td></tr>)}</tbody></table></div>:<p>No submitting accounts in this selection.</p>}
   <p className="hint">Reporting an issue does not mean the submitter caused it. This view does not score workers. To inspect source transcripts and work notes, use Report history.</p>
   <details><summary>Counting method</summary><p>{data.method}</p><p>The window filters report creation time, using a rolling period up to now. Machine/department attribution uses current links; work outcomes use the machine recorded at work time. These dates do not establish a service date or equipment safety.</p></details>
  </>}
 </section>
}

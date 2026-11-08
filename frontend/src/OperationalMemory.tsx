import { apiFetch } from './api'
import { useEffect, useRef, useState } from 'react'
type Repair={status:string;action_note:string;outcome:string|null;technician_name:string;created_at:string;machine_id:string;machine_name:string}
type Match={latest_repair:Repair|null;report_id:string;attempt_id:string;attempt_number:number;facts:{reported_issue:string|null};report_created_at:string;verified_transcript:string;shared_issue_words:string[]}
type Memory={review_id:string;report_id:string;machine_id:string|null;machine_name:string|null;machine_code:string|null;reported_issue:string|null;examined_reports:number;search_truncated:boolean;matches:Match[];method:'shared_issue_words_v1';requires_human_review:true}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'
const text=(v:unknown)=>v===null||typeof v==='string'
function valid(v:unknown,id:string):v is Memory {
 return obj(v)&&v.review_id===id&&typeof v.report_id==='string'&&text(v.machine_id)&&text(v.machine_name)&&text(v.machine_code)&&text(v.reported_issue)&&typeof v.examined_reports==='number'&&Number.isSafeInteger(v.examined_reports)&&v.examined_reports>=0&&typeof v.search_truncated==='boolean'&&v.method==='shared_issue_words_v1'&&v.requires_human_review===true&&Array.isArray(v.matches)&&v.matches.every(m=>obj(m)&&typeof m.report_id==='string'&&m.report_id!==v.report_id&&typeof m.attempt_id==='string'&&typeof m.attempt_number==='number'&&obj(m.facts)&&text(m.facts.reported_issue)&&typeof m.report_created_at==='string'&&Number.isFinite(Date.parse(m.report_created_at))&&typeof m.verified_transcript==='string'&&(m.latest_repair===null||obj(m.latest_repair)&&['status','action_note','technician_name','created_at','machine_id','machine_name'].every(k=>typeof (m.latest_repair as Record<string,unknown>)[k]==='string')&&text(m.latest_repair.outcome))&&Array.isArray(m.shared_issue_words)&&m.shared_issue_words.every(w=>typeof w==='string'))
}
export default function OperationalMemory({reviewId}:{reviewId:string}) {
 const [data,setData]=useState<Memory|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function load(){
  if(active.current)return
  const c=new AbortController();active.current=c;setBusy(true);setError('');setData(null)
  const timer=window.setTimeout(()=>c.abort(),30000)
  try{
   const r=await apiFetch(`/api/fact-reviews/${reviewId}/memory`,{signal:c.signal,cache:'no-store'});const d:unknown=await r.json()
   if(!r.ok)throw new Error(obj(d)&&typeof d.detail==='string'?d.detail:`Memory request failed (${r.status}).`)
   if(!valid(d,reviewId))throw new Error('Unexpected memory response.')
   if(active.current===c&&!c.signal.aborted)setData(d)
  }catch(e){if(active.current===c)setError(c.signal.aborted?'Memory loading timed out. You can safely retry.':e instanceof Error?e.message:'Could not load memory.')}
  finally{window.clearTimeout(timer);if(active.current===c){active.current=null;setBusy(false)}}
 }
 return <section aria-label="Operational Memory" style={{borderTop:'1px solid #64748b',marginTop:16,paddingTop:12}}>
  <h5>Operational Memory</h5>
  <p className="hint">Find earlier reviewed reports for the current machine. Matches use shared issue words; compare the source text before drawing conclusions.</p>
  <button className="secondary" disabled={busy} onClick={load}>{busy?'Searching earlier reports…':'Find related past reports'}</button>
  {error&&<p className="error" role="alert">{error}</p>}
  {data&&<>
   {!data.machine_id?<p>Link this reviewed report to a machine first, then search again.</p>:<>
    <p><strong>{data.machine_name} · {data.machine_code}</strong></p>
    <p>Current reported issue: {data.reported_issue??'Not reported'}</p>
    <p className="hint">Checked {data.examined_reports} earlier reviewed reports. The current report is excluded. {data.search_truncated?'Search covers the 100 most recent earlier reports.':''}</p>
    {!data.matches.length&&<p>{data.examined_reports===0?'No earlier reviewed reports are currently linked to this machine.':'No shared issue words were found in the checked reports.'}</p>}
    {data.matches.map(m=><article key={m.report_id} style={{borderTop:'1px solid #64748b',paddingTop:12,marginTop:12}}>
      <p><strong>{m.facts.reported_issue??'Issue not reported'}</strong></p>
      <p className="hint">Shared issue words: {m.shared_issue_words.join(', ')}</p>
      <p>{m.verified_transcript}</p>
      {m.latest_repair?<div><p><strong>Latest recorded work: {m.latest_repair.status.replaceAll('_',' ')}</strong> · {m.latest_repair.technician_name} · {m.latest_repair.machine_name}</p><p>{m.latest_repair.action_note}</p><p>Reported outcome: {m.latest_repair.outcome?.replaceAll('_',' ')??'Not completed'}</p><p className="hint">Recorded {new Date(m.latest_repair.created_at).toLocaleString()}. This is reported history, not a recommended repair.</p></div>:<p className="hint">No repair action recorded for this report.</p>}
      <p className="hint">Report {m.report_id} · Attempt {m.attempt_number} · Reported {new Date(m.report_created_at).toLocaleString()}</p>
    </article>)}
    <p className="hint">Similar wording does not establish the same fault or a successful repair. Recorded outcomes are human-reported and not independently verified.</p>
   </>}
  </>}
 </section>
}

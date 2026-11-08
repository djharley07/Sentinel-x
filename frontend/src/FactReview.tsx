import { useAccount } from './Auth'
import { apiFetch } from './api'
import { useEffect, useRef, useState } from 'react'
import MachineLink from './MachineLink'
import EvidenceDetective from './EvidenceDetective'
import Redline from './Redline'
import RepairLog from './RepairLog'
type Facts = { equipment_label: string | null; reported_issue: string | null; temperature_value: number | null; temperature_unit: string | null; issue_started_at: string | null }
type Machine = { machine_id: string; code: string; name: string; department: string }
type Review = { review_id: string; facts: Facts; machine_id: string | null; created_at: string; persistence_status: 'saved' }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
function factsValid(v: unknown): v is Facts {
  if (!object(v)) return false
  return ['equipment_label','reported_issue','temperature_unit','issue_started_at'].every(k => v[k] === null || typeof v[k] === 'string') &&
    (v.temperature_value === null || typeof v.temperature_value === 'number' && Number.isFinite(v.temperature_value))
}
function reviewValid(v: unknown): v is Review {
  return object(v) && typeof v.review_id === 'string' && factsValid(v.facts) &&
    (v.machine_id === null || typeof v.machine_id === 'string') && typeof v.created_at === 'string' && Number.isFinite(Date.parse(v.created_at)) && v.persistence_status === 'saved'
}
const labels = { equipment_label: 'Equipment label', reported_issue: 'Reported issue', temperature_value: 'Temperature value', temperature_unit: 'Temperature unit', issue_started_at: 'Issue started' }
type Key = keyof Facts
export default function FactReview({ extractionId, initial }: { extractionId: string; initial: Facts }) {
  const account=useAccount()
  const [draft,setDraft]=useState<Record<Key,string>>(() => Object.fromEntries(Object.entries(initial).map(([k,v])=>[k,v === null ? '' : String(v)])) as Record<Key,string>)
  const [machine,setMachine]=useState('')
  const [machines,setMachines]=useState<Machine[]>([])
  const [review,setReview]=useState<Review|null>(null)
  const [loaded,setLoaded]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [pending,setPending]=useState<string|null>(null)
  const active=useRef<AbortController|null>(null)
  useEffect(()=>()=>{active.current?.abort();active.current=null},[])
  async function run(save=false) {
    if(active.current)return
    let body=pending
    if(save && !body) {
      const temp=draft.temperature_value.trim()
      if(temp && !Number.isFinite(Number(temp))){setError('Enter a valid temperature number or leave it blank.');return}
      if(!temp && draft.temperature_unit.trim()){setError('Leave the unit blank when temperature is unknown.');return}
      const nullable=(v:string)=>v.trim()||null
      body=JSON.stringify({facts:{equipment_label:nullable(draft.equipment_label),reported_issue:nullable(draft.reported_issue),temperature_value:temp?Number(temp):null,temperature_unit:nullable(draft.temperature_unit),issue_started_at:nullable(draft.issue_started_at)},machine_id:machine||null})
      setPending(body)
    }
    const c=new AbortController();active.current=c
    const timer=window.setTimeout(()=>c.abort(),60000)
    setBusy(true);setError('')
    try {
      const response=await apiFetch(`/api/extractions/${extractionId}/review`,{method:save?'POST':'GET',headers:save?{'Content-Type':'application/json'}:undefined,body:save?body:undefined,signal:c.signal,cache:'no-store'})
      const data:unknown=await response.json()
      if(!response.ok) {
        if(response.status===422 && active.current===c)setPending(null)
        throw new Error(object(data)&&typeof data.detail==='string'?data.detail:`Request failed (${response.status}).`)
      }
      if(!object(data)||data.extraction_id!==extractionId||!(data.review===null&&!save||reviewValid(data.review)))throw new Error('Unexpected review response.')
      if(active.current!==c||c.signal.aborted)return
      if(data.review!==null){setReview(data.review as Review);setLoaded(true);setPending(null);return}
      const mr=await apiFetch('/api/machines',{signal:c.signal,cache:'no-store'})
      const md:unknown=await mr.json()
      if(!mr.ok||!object(md)||!Array.isArray(md.machines)||!md.machines.every(m=>object(m)&&['machine_id','code','name','department'].every(k=>typeof m[k]==='string')))throw new Error('Could not load demo machines. Check migration 003 and retry.')
      if(active.current!==c||c.signal.aborted)return
      setMachines(md.machines as Machine[]);setLoaded(true)
    } catch(e){if(active.current===c)setError(c.signal.aborted?'Request timed out. Check saved review or retry the same submission.':e instanceof Error?e.message:'Review request failed.')}
    finally{window.clearTimeout(timer);if(active.current===c){active.current=null;setBusy(false)}}
  }
  return <section aria-label="Review maintenance facts">
    <h5>Human fact review and machine link</h5>
    {!review&&<button className="secondary" disabled={busy} onClick={()=>run()}>{busy?'Working…':loaded?'Check saved review':'Open fact review'}</button>}
    {error&&<p className="error" role="alert">{error}</p>}
    {busy&&<p role="status">Saving or checking review…</p>}
    {review?<>
      <p><strong>Facts reviewed · Local demo</strong></p>
      <dl>{(Object.keys(labels) as Key[]).map(k=><div key={k}><dt>{labels[k]}</dt><dd>{review.facts[k]??'Not reported'}</dd></div>)}</dl>
      <p>Original machine selection: {review.machine_id ? machines.find(m=>m.machine_id===review.machine_id)?.name ?? `Linked (${review.machine_id})` : 'Unlinked / needs identification'}</p>
      <p className="hint">Saved {new Date(review.created_at).toLocaleString()}. The original AI draft above is preserved. This confirms reported facts, not machine safety.</p>
      {account.role === 'owner' && <MachineLink key={review.review_id} reviewId={review.review_id} />}
      <EvidenceDetective key={`evidence:${review.review_id}`} reviewId={review.review_id} />
      <Redline key={`redline:${review.review_id}`} reviewId={review.review_id} />
      <RepairLog key={`repairs:${review.review_id}`} reviewId={review.review_id} />
    </>:loaded&&<>
      <p className="hint">Check against the verified transcript. Leave unknown fields blank. Choose a machine only if you can identify it. Saving finalizes this review.</p>
      <fieldset disabled={busy||pending!==null} style={{border:0,padding:0,display:'grid',gap:10}}>
        {(Object.keys(labels) as Key[]).map(k=><label key={k}>{labels[k]}<input style={{display:'block',width:'100%',boxSizing:'border-box'}} maxLength={2000} type={k==='temperature_value'?'number':'text'} step={k==='temperature_value'?'any':undefined} value={draft[k]} onChange={e=>setDraft({...draft,[k]:e.target.value})}/></label>)}
        <label>Demo machine<select style={{display:'block',width:'100%'}} value={machine} onChange={e=>setMachine(e.target.value)}><option value="">Unlinked / unsure</option>{machines.map(m=><option key={m.machine_id} value={m.machine_id}>{m.name} · {m.code} · {m.department}</option>)}</select></label>
      </fieldset>
      <button disabled={busy} onClick={()=>run(true)}>{pending?'Retry same review':'Confirm facts and save machine link'}</button>
      {pending&&<p className="hint">Fields are locked until saving is confirmed. Check saved review to recover an uncertain result.</p>}
    </>}
  </section>
}

import { useId,useRef,useState } from 'react'
import { apiFetch } from './api'
import EquipmentCheck,{equipmentKey} from './EquipmentCheck'
import ReportReadback from './ReportReadback'
type Payload={request_id:string;text:string;reason:string;equipment_check_acknowledged:boolean}
export default function TranscriptCorrection({attemptId,text,active=true,onSaved}:{attemptId:string;text:string;active?:boolean;onSaved:()=>void}){
 const id=useId(),inFlight=useRef(false)
 const [open,setOpen]=useState(false),[draft,setDraft]=useState(text),[reason,setReason]=useState('')
 const [approval,setApproval]=useState(''),[pending,setPending]=useState<Payload|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false)
 const clean=draft.trim(),ready=[equipmentKey(attemptId,clean),`ack:${equipmentKey(attemptId,clean)}`].includes(approval)
 async function save(){
  if(inFlight.current||saved)return
  const payload=pending??{request_id:crypto.randomUUID(),text:clean,reason:reason.trim(),equipment_check_acknowledged:approval===`ack:${equipmentKey(attemptId,clean)}`}
  inFlight.current=true;setBusy(true);setPending(payload);setError('')
  try{
   const r=await apiFetch(`/api/attempts/${attemptId}/corrections`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)})
   const d=await r.json() as {attempt_id?:string;persistence_status?:string;detail?:string}
   if(!r.ok){
    if(r.status===422)setPending(null)
    throw new Error(typeof d.detail==='string'?d.detail:'Correction saving could not be confirmed.')
   }
   if(d.persistence_status!=='saved'||typeof d.attempt_id!=='string')throw new Error('Unexpected correction response. Retry the same correction.')
   setPending(null);setSaved(true);onSaved()
  }catch(e){setError(e instanceof Error?e.message:'Saving could not be confirmed. Retry the same correction.')}
  finally{inFlight.current=false;setBusy(false)}
 }
 if(saved)return <p role="status">Correction saved as a new version. Reload this report to see it.</p>
 if(!open)return <button type="button" className="secondary" onClick={()=>setOpen(true)}>Correct this saved transcript</button>
 return <section aria-label="Correct saved transcript" style={{borderTop:'1px solid #64748b',marginTop:16,paddingTop:12}}>
  <h4>Correct this saved transcript</h4>
  <p>The original and earlier versions stay in history. This saves a new current version without another recording or transcription request.</p>
  <p className="hint">Earlier facts, evidence, escalations and work remain attached to their earlier version. Check the facts again for the new version. A correction does not close an escalation or mark a repair completed.</p>
  <label htmlFor={`${id}-text`}>Corrected transcript</label>
  <textarea id={`${id}-text`} rows={5} maxLength={20000} value={draft} disabled={busy||pending!==null} onChange={e=>setDraft(e.target.value)}/>
  {clean&&<EquipmentCheck attemptId={attemptId} text={clean} onReady={setApproval} onUse={setDraft} disabled={busy||pending!==null}/>}
  {clean&&<details style={{margin:'12px 0'}}><summary>Listen before confirming (optional)</summary><ReportReadback key={`preview:${clean}`} attemptId={attemptId} previewText={clean} active={active}/></details>}
  <label htmlFor={`${id}-reason`}>Why are you correcting it?</label>
  <textarea id={`${id}-reason`} rows={2} maxLength={2000} value={reason} disabled={busy||pending!==null} onChange={e=>setReason(e.target.value)}/>
  {error&&<p role="alert" className="error">{error}</p>}
  {pending&&!busy&&<p className="hint">Keep the same text and retry to confirm saving. If a newer version exists, reload Report history.</p>}
  <button type="button" disabled={busy||(!pending&&(!ready||!reason.trim()||!clean||clean===text))} onClick={save}>{busy?'Saving…':pending?'Retry same correction':'Save new corrected version'}</button>
  <button type="button" className="secondary" disabled={busy||pending!==null} onClick={()=>setOpen(false)}>Cancel correction</button>
 </section>
}

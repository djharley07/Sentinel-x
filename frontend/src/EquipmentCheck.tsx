import { useEffect, useState } from 'react'
import { apiFetch } from './api'
type Warning = {machine_id:string;name:string;code:string;start:number;end:number;heard:string;replacement:string}
export const equipmentKey = (attemptId:string,text:string) => `${attemptId}:${text}`
export default function EquipmentCheck({attemptId,text,onReady,onUse,disabled=false}:{attemptId:string;text:string;onReady:(key:string)=>void;onUse:(text:string)=>void;disabled?:boolean}) {
 const key=equipmentKey(attemptId,text)
 const [result,setResult]=useState<{key:string;warnings:Warning[]}|null>(null)
 const [error,setError]=useState(''),[retry,setRetry]=useState(0),[ack,setAck]=useState('')
 useEffect(()=>{
  const c=new AbortController()
  setResult(null);setError('');setAck('');onReady('')
  const timer=window.setTimeout(async()=>{
   try{
    const r=await apiFetch(`/api/attempts/${attemptId}/equipment-check`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:c.signal})
    const d=await r.json() as {warnings?:Warning[];detail?:string}
    if(!r.ok)throw new Error(typeof d.detail==='string'?d.detail:'Could not check equipment names.')
    if(!Array.isArray(d.warnings)||!d.warnings.every(w=>typeof w.name==='string'&&typeof w.heard==='string'&&typeof w.replacement==='string'&&Number.isInteger(w.start)&&Number.isInteger(w.end)&&w.start>=0&&w.end>w.start&&w.end<=Array.from(text).length))throw new Error('Unexpected equipment-check response.')
    if(c.signal.aborted)return
    setResult({key,warnings:d.warnings})
    if(d.warnings.length===0)onReady(key)
   }catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'Could not check equipment names.')}
   finally{window.clearTimeout(timeout)}
  },350)
  const timeout=window.setTimeout(()=>{c.abort();setError('Equipment check timed out. Retry the check.');},30000)
  return()=>{window.clearTimeout(timer);window.clearTimeout(timeout);c.abort()}
 },[attemptId,text,key,retry,onReady])
 const current=result?.key===key?result:null
 return <section aria-label="Equipment wording check" style={{border:'1px solid #64748b',borderRadius:8,padding:12,margin:'12px 0'}}>
  <h4 style={{margin:'0 0 8px'}}>Equipment suggestions</h4>
  {!current&&!error&&<p role="status">Checking equipment names…</p>}
  {error&&<><p className="error" role="alert">{error}</p><button type="button" className="secondary" disabled={disabled} onClick={()=>setRetry(n=>n+1)}>Retry equipment check</button></>}
  {current?.warnings.length===0&&<p className="hint">No possible name mismatch found by this check.</p>}
  {current&&current.warnings.length>0&&<>
   <div role="alert">
    {current.warnings.map((w,i)=><div key={`${w.machine_id}:${i}`}>
     <p style={{marginTop:0}}>You wrote “{w.heard}”. Did you mean <strong>{w.name}</strong> ({w.code})?</p>
     <button type="button" className="secondary" disabled={disabled} onClick={()=>{const chars=Array.from(text);onUse(chars.slice(0,w.start).join('')+w.replacement+chars.slice(w.end).join(''))}}>Use {w.name} in my draft</button>
    </div>)}
   </div>
   <label><input type="checkbox" disabled={disabled} checked={ack===key} onChange={e=>{setAck(e.target.checked?key:'');onReady(e.target.checked?`ack:${key}`:'')}}/> Keep my wording — I checked the suggestion.</label>

  </>}
  <details style={{marginTop:10}}><summary className="hint">About this check</summary>
   <p className="hint">Compares similar names with your available machines. It does not add missing numbers, verify the recording or catch every error. Check numbers, units and “not” yourself. Nothing changes automatically.</p>
   {current&&<button type="button" className="secondary" style={{width:'auto',padding:'6px 12px'}} disabled={disabled} onClick={()=>setRetry(n=>n+1)}>Check names again</button>}
  </details>
 </section>
}

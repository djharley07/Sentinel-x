import { apiFetch } from './api'
import { useEffect, useRef, useState } from 'react'
type Evidence={evidence_id:string;source_url:string;claim_checked:string;observation:string;assessment:'supports'|'conflicts'|'cannot_verify';created_at:string;image_url:string;assessment_method:'human_review';source_kind:'online_demo'|'ai_generated_demo'}
type Page={review_id:string;evidence:Evidence[];offset:number;has_more:boolean}
const object=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null
function valid(v:unknown):v is Evidence{return object(v)&&typeof v.evidence_id==='string'&&typeof v.source_url==='string'&&/^https?:\/\//.test(v.source_url)&&typeof v.claim_checked==='string'&&typeof v.observation==='string'&&['supports','conflicts','cannot_verify'].includes(v.assessment as string)&&typeof v.created_at==='string'&&Number.isFinite(Date.parse(v.created_at))&&v.image_url===`/api/evidence/${v.evidence_id}/image`&&v.assessment_method==='human_review'&&(v.source_kind==='online_demo'||v.source_kind==='ai_generated_demo')}
const label={supports:'Supports the selected claim',conflicts:'Conflicts with the selected claim',cannot_verify:'Cannot verify the selected claim'}
export default function EvidenceDetective({reviewId}:{reviewId:string}) {
 const [sourceKind,setSourceKind]=useState('online_demo')
 const [file,setFile]=useState<File|null>(null),[source,setSource]=useState(''),[claim,setClaim]=useState(''),[note,setNote]=useState(''),[assessment,setAssessment]=useState('cannot_verify')
 const [page,setPage]=useState<Page|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false)
 const [pending,setPending]=useState<string|null>(null)
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 async function run(upload=false,offset=0){
  if(active.current)return
  if(upload&&(!file||!source.trim()||!claim.trim()||!note.trim())){setError('Choose a photo and fill in its source, claim and observations.');return}
  if(upload&&file&&(!file.size||file.size>5*1024*1024)){setError('Choose a photo under 5 MB.');return}
  const c=new AbortController();active.current=c;setBusy(true);setError('')
  const timer=window.setTimeout(()=>c.abort(),60000)
  try{
   let body:FormData|undefined
   if(upload){const id=pending??crypto.randomUUID();setPending(id);body=new FormData();body.append('request_id',id);body.append('source_url',source.trim());body.append('claim_checked',claim.trim());body.append('observation',note.trim());body.append('assessment',assessment);body.append('source_kind',sourceKind);body.append('image',file!)}
   const r=await apiFetch(`/api/fact-reviews/${reviewId}/evidence${upload?'':`?offset=${offset}`}`,{method:upload?'POST':'GET',body,signal:c.signal,cache:'no-store'})
   const d:unknown=await r.json()
   if(!r.ok){if([413,415,422].includes(r.status))setPending(null);throw new Error(object(d)&&typeof d.detail==='string'?d.detail:`Evidence request failed (${r.status}).`)}
   if(active.current!==c||c.signal.aborted)return
   if(!object(d)||d.review_id!==reviewId)throw new Error('Unexpected evidence response.')
   if(upload){if(!valid(d.evidence)||d.evidence.evidence_id!==body?.get('request_id'))throw new Error('Unexpected upload response.');setSaved(true);setPending(null);setPage({review_id:reviewId,evidence:[d.evidence],offset:0,has_more:false})}
   else{if(!Array.isArray(d.evidence)||!d.evidence.every(valid)||d.offset!==offset||typeof d.has_more!=='boolean')throw new Error('Unexpected evidence list.');setPage(d as Page);if(pending&&d.evidence.some(e=>e.evidence_id===pending)){setSaved(true);setPending(null)}}
  }catch(e){if(active.current===c)setError(c.signal.aborted?'Request timed out. Load saved evidence to check the result, or retry the same upload.':e instanceof Error?e.message:'Evidence request failed.')}
  finally{window.clearTimeout(timer);if(active.current===c){active.current=null;setBusy(false)}}
 }
 return <section aria-label="Evidence Detective" style={{borderTop:'1px solid #64748b',paddingTop:12,marginTop:16}}>
  <h5>Evidence Detective · Human review</h5>
  <p className="hint">Online demo images illustrate test cases. They are not verified photos of this factory. You assess the selected claim; no AI image analysis runs in this version.</p>
  <button className="secondary" disabled={busy} onClick={()=>run()}>Load saved evidence</button>
  {error&&<p className="error" role="alert">{error}</p>}{busy&&<p role="status">Working with evidence…</p>}
  {!saved?<>
   <fieldset disabled={busy||pending!==null} style={{border:0,padding:0,display:'grid',gap:10}}>
    <label>Demo photo (JPEG, PNG or WebP · under 5 MB)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
    <label>Image source type<select style={{display:'block',width:'100%'}} value={sourceKind} onChange={e=>setSourceKind(e.target.value)}><option value="online_demo">Online demo photo</option><option value="ai_generated_demo">AI-generated demo image</option></select></label>
    <label>Source page URL<input style={{display:'block',width:'100%',boxSizing:'border-box'}} type="url" maxLength={2000} value={source} onChange={e=>setSource(e.target.value)}/></label>
    <label>Specific claim to check<input style={{display:'block',width:'100%',boxSizing:'border-box'}} maxLength={2000} value={claim} onChange={e=>setClaim(e.target.value)} placeholder="For example: the image shows a readable temperature display"/></label>
    <label>What is visible, and what cannot be established?<textarea style={{display:'block',width:'100%',boxSizing:'border-box'}} maxLength={4000} value={note} onChange={e=>setNote(e.target.value)}/></label>
    <label>Your assessment<select style={{display:'block',width:'100%'}} value={assessment} onChange={e=>setAssessment(e.target.value)}>{Object.entries(label).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
   </fieldset>
   <p className="hint">A still photo normally cannot verify unusual noise or temperature without a readable measurement. An unrelated demo photo cannot establish the condition of Motor 15.</p>
   <button disabled={busy} onClick={()=>run(true)}>{pending?'Retry same evidence upload':'Save demo photo and assessment'}</button>
   {pending&&<p className="hint">Submitted fields are locked for safe retry. Load saved evidence to check whether it saved.</p>}
  </>:<><p role="status">Demo evidence saved.</p><button className="secondary" disabled={busy} onClick={()=>{setSaved(false);setFile(null);setSource('');setClaim('');setNote('');setAssessment('cannot_verify')}}>Add another demo photo</button></>}
  {page&&<>{!page.evidence.length&&<p>No demo evidence saved.</p>}{page.evidence.map(e=><article key={e.evidence_id} style={{borderTop:'1px solid #64748b',marginTop:12,paddingTop:12}}>
   <p><strong>{e.source_kind==='ai_generated_demo'?'AI-generated demo image':'Online demo photo'} · {label[e.assessment]}</strong></p><img src={e.image_url} alt="Uploaded online demo evidence" loading="lazy" style={{maxWidth:'100%',maxHeight:350,objectFit:'contain'}}/>
   <p>Claim: {e.claim_checked}</p><p>Human observation: {e.observation}</p><p><a href={e.source_url} target="_blank" rel="noopener noreferrer">Source page</a></p><p className="hint">Local demo human review · {new Date(e.created_at).toLocaleString()} · Evidence {e.evidence_id}</p>
  </article>)}<button className="secondary" disabled={busy||page.offset===0} onClick={()=>run(false,Math.max(0,page.offset-10))}>Previous evidence</button><button className="secondary" disabled={busy||!page.has_more} onClick={()=>run(false,page.offset+10)}>Next evidence</button></>}
 </section>
}

import { useEffect,useId,useRef,useState,type FormEvent } from 'react'
import { apiFetch } from './api'
import './MachineReferences.css'
type Machine={machine_id:string;code:string;name:string;manufacturer:string;model:string;revision:number;active:boolean}
type Document={document_id:string;title:string;document_version:string;kind:'fictional_reference'|'owner_reference';manufacturer:string;model:string;content:string;content_sha256:string;available:boolean;revision:number;created_at:string;matches_machine:boolean}
type PdfPreview={text:string;page_count:number;warning:string}
type Event={event_id:string;document_id:string;revision:number;available:boolean;reason:string;actor:string;created_at:string}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'
const strings=(v:unknown,keys:string[])=>obj(v)&&keys.every(k=>typeof v[k]==='string')
function validDoc(v:unknown):v is Document{return strings(v,['document_id','title','document_version','manufacturer','model','content','content_sha256','created_at'])&&obj(v)&&['fictional_reference','owner_reference'].includes(String(v.kind))&&typeof v.available==='boolean'&&typeof v.matches_machine==='boolean'&&Number.isInteger(v.revision)}
export default function MachineReferences(){
 const id=useId(),[machines,setMachines]=useState<Machine[]>([]),[mid,setMid]=useState(''),[docs,setDocs]=useState<Document[]>([]),[history,setHistory]=useState<Event[]>([])
 const [title,setTitle]=useState(''),[version,setVersion]=useState(''),[kind,setKind]=useState('fictional_reference'),[content,setContent]=useState('')
 const [selected,setSelected]=useState<Document|null>(null),[reviewed,setReviewed]=useState(false),[reason,setReason]=useState('')
 const [pdfFile,setPdfFile]=useState<File|null>(null),[pdfPreview,setPdfPreview]=useState<PdfPreview|null>(null),[pdfReviewed,setPdfReviewed]=useState(false),[pdfBusy,setPdfBusy]=useState(false)
 const pdfControl=useRef<AbortController|null>(null)
 const [importKey,setImportKey]=useState(0)
 const [loadingFile,setLoadingFile]=useState(false)
 const [busy,setBusy]=useState(false),[pending,setPending]=useState<{url:string;body:string}|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const control=useRef<AbortController|null>(null),fileSerial=useRef(0),mounted=useRef(true)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;fileSerial.current++;control.current?.abort();control.current=null;pdfControl.current?.abort();pdfControl.current=null}},[])
 const machine=machines.find(m=>m.machine_id===mid),locked=busy||loadingFile||pdfBusy||pending!==null
 function clearSelection(){setSelected(null);setReviewed(false);setReason('')}
 async function request(url:string,signal:AbortSignal,body?:string){
  const r=await apiFetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body,signal})
  const d:unknown=await r.json()
  if(!r.ok){if(body&&[403,404,409,422].includes(r.status))setPending(null);throw new Error(obj(d)&&typeof d.detail==='string'?d.detail:`Document request failed (${r.status}). Check the document fields and reload.`)}
  return d
 }
 function acceptDocs(d:unknown){
  if(!mounted.current)return
  if(!obj(d)||!Array.isArray(d.documents)||!d.documents.every(validDoc)||!Array.isArray(d.history)||!d.history.every(e=>strings(e,['event_id','document_id','reason','actor','created_at'])&&obj(e)&&typeof e.available==='boolean'&&Number.isInteger(e.revision)))throw new Error('Unexpected document response.')
  setDocs(d.documents);setHistory(d.history as Event[]);clearSelection()
 }
 async function run(action:'machines'|'documents'|'create'|'availability'|'retry'){
  if(control.current||pdfControl.current)return
  const c=new AbortController();control.current=c;setBusy(true);setError('');setNotice('');const timer=window.setTimeout(()=>c.abort(),30000)
  try{
   if(action==='machines'){
    const d=await request('/api/machine-references/machines',c.signal)
    if(!obj(d)||!Array.isArray(d.machines)||!d.machines.every(m=>strings(m,['machine_id','code','name','manufacturer','model'])&&obj(m)&&Number.isInteger(m.revision)&&typeof m.active==='boolean'))throw new Error('Unexpected machine list.')
    if(control.current===c&&!c.signal.aborted){setMachines(d.machines as Machine[]);setDocs([]);setHistory([]);clearSelection();setMid('')}
   }else if(action==='documents')acceptDocs(await request(`/api/machine-references/${mid}`,c.signal))
   else{
    let mutation=pending
    if(action==='create'){
     if(!machine)throw new Error('Choose a machine first.')
     mutation={url:'/api/machine-references',body:JSON.stringify({request_id:crypto.randomUUID(),machine_id:mid,expected_machine_revision:machine.revision,title:title.trim(),document_version:version.trim(),kind,content:content.trim()})}
    }else if(action==='availability'){
     if(!selected)throw new Error('Select a document to review.')
     mutation={url:'/api/machine-references/availability',body:JSON.stringify({request_id:crypto.randomUUID(),document_id:selected.document_id,expected_revision:selected.revision,available:!selected.available,reviewed,reason:reason.trim()})}
    }
    if(!mutation)throw new Error('There is no pending change.')
    setPending(mutation);const result=await request(mutation.url,c.signal,mutation.body)
    if(control.current!==c||c.signal.aborted)return
    if(!obj(result)||result.persistence_status!=='saved'||typeof result.document_id!=='string')throw new Error('Unexpected save confirmation. Retry the same change to check it.')
    setPending(null);setNotice('Saved. Reload the document list if it is not shown below. Start a new chat conversation after reference changes.')
    if(mutation.url==='/api/machine-references'){setTitle('');setVersion('');setContent('');setPdfFile(null);setPdfPreview(null);setPdfReviewed(false);setImportKey(k=>k+1)}
    acceptDocs(await request(`/api/machine-references/${mid}`,c.signal))
   }
  }catch(e){if(control.current===c)setError(c.signal.aborted?'Request timed out. Retry the same pending change to confirm its result.':e instanceof Error?e.message:'Document request failed.')}
  finally{window.clearTimeout(timer);if(control.current===c){control.current=null;setBusy(false)}}
 }
 async function loadText(file:File|undefined){
  const serial=++fileSerial.current
  if(!file)return
  setPdfPreview(null);setPdfFile(null);setPdfReviewed(false)
  if(!file.name.toLowerCase().endsWith('.txt')||file.size>32000){setError('Choose a UTF-8 .txt file up to 32 KB and 8,000 characters, or use the separate PDF preview control.');return}
  setLoadingFile(true)
  try{
   const text=await file.text()
   if(!mounted.current||serial!==fileSerial.current)return
   if(!text.trim()||text.length>8000||text.includes('\uFFFD'))throw new Error('Use nonempty UTF-8 plain text up to 8,000 characters.')
   setContent(text);setError('')
  }catch(e){if(mounted.current&&serial===fileSerial.current)setError(e instanceof Error?e.message:'Could not read this text file.')}
  finally{if(mounted.current)setLoadingFile(false)}
 }
 async function previewPdf(){
  if(!pdfFile||locked||pdfControl.current)return
  if(!pdfFile.name.toLowerCase().endsWith('.pdf')||pdfFile.size===0||pdfFile.size>5*1024*1024){setError('Choose a nonempty PDF up to 5 MiB.');return}
  const c=new AbortController();pdfControl.current=c;setPdfBusy(true);setPdfPreview(null);setPdfReviewed(false);setError('');setNotice('')
  const timer=window.setTimeout(()=>c.abort(),25000)
  try{
   const body=new FormData();body.append('pdf',pdfFile)
   const r=await apiFetch('/api/machine-references/pdf-preview',{method:'POST',body,signal:c.signal});const d:unknown=await r.json()
   if(!r.ok)throw new Error(obj(d)&&typeof d.detail==='string'?d.detail:`PDF preview failed (${r.status}).`)
   if(!obj(d)||typeof d.text!=='string'||!d.text.trim()||d.text.length>8000||!Number.isInteger(d.page_count)||(d.page_count as number)<1||(d.page_count as number)>20||typeof d.warning!=='string'||d.persistence_status!=='not_saved')throw new Error('Unexpected PDF preview response. No draft was replaced.')
   if(pdfControl.current===c&&!c.signal.aborted)setPdfPreview(d as PdfPreview)
  }catch(e){if(pdfControl.current===c)setError(c.signal.aborted?'PDF preview timed out. No document was saved.':e instanceof Error?e.message:'Could not preview PDF text.')}
  finally{window.clearTimeout(timer);if(pdfControl.current===c){pdfControl.current=null;setPdfBusy(false)}}
 }
 function submit(e:FormEvent){e.preventDefault();if(!locked&&!pdfPreview)void run('create')}

 return <section className="card machine-references"><p className="eyebrow">OWNER WORKSPACE / REFERENCE DOCUMENTS</p><h2>Machine reference documents</h2>
  <p>Add plain text or preview text extracted from a PDF for a specific machine. Review the whole document before enabling it for Ask SENTINEL. Each document keeps its text, version and machine/model binding; attach a new version to change its content.</p>
  <p className="hint">Owner-supplied text is not independently authenticated or automatically factory-approved. Only add material you are authorized to share with the configured answer provider. Fictional references must stay labelled fictional.</p>
  <button type="button" className="secondary" disabled={locked} onClick={()=>run('machines')}>Refresh machines</button>
  <label htmlFor={`${id}-machine`}>Machine<select id={`${id}-machine`} value={mid} disabled={locked} onChange={e=>{fileSerial.current++;setMid(e.target.value);setDocs([]);setHistory([]);clearSelection();setTitle('');setVersion('');setContent('');setError('');setPdfFile(null);setPdfPreview(null);setPdfReviewed(false)}}><option value="">Choose a machine</option>{machines.map(m=><option value={m.machine_id} key={m.machine_id}>{m.name} · {m.code}{m.active?'':' · Inactive'}</option>)}</select></label>
  {machine&&<><p>Manufacturer: {machine.manufacturer||'Not recorded'} · Model: {machine.model||'Not recorded'}</p><button type="button" className="secondary" disabled={locked} onClick={()=>run('documents')}>Load documents and history</button></>}
  {pdfBusy&&<p role="status">Extracting a temporary PDF text preview. No document is being saved.</p>}
  {loadingFile&&<p role="status">Reading the text file into your draft…</p>}
  {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {pending&&<><p className="hint">Submitted values are locked until the result is confirmed.</p><button type="button" disabled={busy} onClick={()=>run('retry')}>Retry same document change</button></>}
  {mid&&<><h3>Saved document versions</h3>{docs.length===0?<p>Load documents above, or add the first version below.</p>:<ul>{docs.map(d=><li key={d.document_id}><strong>{d.title} · {d.document_version}</strong><p>{d.kind==='fictional_reference'?'Fictional demo reference':'Owner-supplied reference'} · {d.available?'Enabled':'Not enabled'}{d.matches_machine?'':' · Model/manufacturer mismatch — excluded from chat'}</p><button type="button" className="secondary" disabled={locked} onClick={()=>{setSelected(d);setReviewed(false);setReason('')}}>Review this version</button></li>)}</ul>}
   {selected&&<article className="reference-review"><h3>{selected.title} · version {selected.document_version}</h3><p>Bound manufacturer: {selected.manufacturer||'Not recorded'} · Bound model: {selected.model||'Not recorded'}</p><pre>{selected.content}</pre>
    {!selected.available&&<label className="reference-check"><input type="checkbox" checked={reviewed} disabled={locked} onChange={e=>setReviewed(e.target.checked)}/>I reviewed the full text, its provenance and its applicability to this machine/model.</label>}
    <label>Reason for availability change<textarea maxLength={1000} value={reason} disabled={locked} onChange={e=>setReason(e.target.value)}/></label>
    <button type="button" disabled={locked||!reason.trim()||(!selected.available&&(!reviewed||!selected.matches_machine||!machine?.active))} onClick={()=>run('availability')}>{selected.available?'Withdraw from chat':'Enable this version for chat'}</button>
   </article>}
   <form onSubmit={submit}><h3>Add a document version</h3><fieldset disabled={locked||!machine?.active}>
    <label>Document title<input required maxLength={120} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>Document version<input required maxLength={60} value={version} onChange={e=>setVersion(e.target.value)} placeholder="For example: 1.0"/></label>
    <label>Source type<select value={kind} onChange={e=>setKind(e.target.value)}><option value="fictional_reference">Fictional demo reference</option><option value="owner_reference">Owner-supplied reference (authenticity not independently verified)</option></select></label>
    <p className="hint">Owner-supplied references require the machine manufacturer and exact model to be recorded before enabling. Up to two versions can be enabled per machine; withdraw older or conflicting versions first.</p>
    <label>Load a UTF-8 text file (optional)<input key={`text:${mid}:${importKey}`} type="file" accept=".txt,text/plain" onChange={e=>void loadText(e.target.files?.[0])}/></label>
    <label>Choose a text-based PDF (optional)<input key={`pdf:${mid}:${importKey}`} type="file" accept=".pdf,application/pdf" onChange={e=>{setPdfFile(e.target.files?.[0]??null);setPdfPreview(null);setPdfReviewed(false);setError('')}}/></label>
    <p className="hint">Up to 5 MiB and 20 pages; extracted text must fit 8,000 characters. Choosing a PDF sends nothing. Preview sends it only to this backend for text extraction; it does not call AI or save a document. Image-only pages and encrypted PDFs are unsupported; existing OCR text layers still need checking.</p>
    <button type="button" className="secondary" disabled={locked||!pdfFile} onClick={previewPdf}>{pdfBusy?'Extracting PDF text…':'Preview PDF text'}</button>
    {pdfPreview&&<section className="reference-review"><h3>PDF text preview · {pdfPreview.page_count} pages</h3><p>{pdfPreview.warning}</p><pre>{pdfPreview.text}</pre>
     <label className="reference-check"><input type="checkbox" checked={pdfReviewed} onChange={e=>setPdfReviewed(e.target.checked)}/>I compared every page with the original PDF and checked that the text is suitable to use as a draft.</label>
     <button type="button" disabled={!pdfReviewed} onClick={()=>{setContent(pdfPreview.text);setPdfPreview(null);setPdfReviewed(false);setNotice('PDF text copied into the editable draft. Check and correct it before saving for owner review.')}}>Use extracted text in draft</button>
     <button type="button" className="secondary" onClick={()=>{setPdfPreview(null);setPdfReviewed(false)}}>Discard PDF preview</button>
    </section>}
    <label>Document text<textarea required rows={12} maxLength={8000} value={content} onChange={e=>{fileSerial.current++;setContent(e.target.value)}}/></label><p className="hint">{content.length}/8,000 characters. Reading a file fills this draft only. Save stores the text in the database; enabling makes it eligible for explicit machine-scoped chat requests. PDF import extracts text only. Diagrams, table relationships and signatures are not verified; no OCR runs. Original PDFs are not retained. Page markers refer to the uploaded file and may change if you edit the draft.</p>
    <button disabled={!title.trim()||!version.trim()||!content.trim()||pdfPreview!==null}>Save version for review</button>
   </fieldset></form>
   {history.length>0&&<details><summary>Document availability history · Latest 20</summary><ul>{history.map(e=><li key={e.event_id}><strong>{e.available?'Enabled':'Not enabled'} · revision {e.revision}</strong><p>{docs.find(d=>d.document_id===e.document_id)?.title??e.document_id} · {e.reason}</p><p className="hint">{e.actor} · {new Date(e.created_at).toLocaleString()}</p></li>)}</ul></details>}
  </>}
 </section>
}

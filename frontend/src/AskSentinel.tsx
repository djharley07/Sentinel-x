import VoiceQuestion from './VoiceQuestion'
import AnswerSpeaker from './AnswerSpeaker'
import { useEffect,useId,useRef,useState,type FormEvent } from 'react'
import { apiFetch } from './api'
import { useAccount } from './Auth'
import './AskSentinel.css'
type Source={id:string;title:string;text:string;kind:'project_guide'|'demo_learning_note'|'fictional_reference'|'owner_reference'}
type Paragraph={text:string;evidence:{source_id:string;quote:string}[]}
const answerLanguages = { english: 'English', hindi: 'Hindi', bengali: 'Bengali', hinglish: 'Hinglish', benglish: 'Benglish' }
type AnswerLanguage = keyof typeof answerLanguages
type Answer={answer_language?:AnswerLanguage;speech_available?:boolean;answer_mode?:'explanation'|'reference_excerpt';paragraphs:Paragraph[];context_token:string;status:'answered'|'clarify'|'not_covered';message:string;sources:Source[];reference_version:string;persistence_status:'not_saved'}
type Turn={id:number;question:string;answer:Answer}
function ProgressiveText({text,onProgress}:{text:string;onProgress:()=>void}){
 const [length,setLength]=useState(0)
 useEffect(()=>{
  if(length>=text.length)return
  const timer=window.setTimeout(()=>setLength(Math.min(text.length,length+Math.max(2,Math.ceil(text.length/80)))),22)
  return()=>window.clearTimeout(timer)
 },[length,text])
 useEffect(()=>{onProgress()},[length,onProgress])
 return <>{text.slice(0,length)}{length<text.length&&<span className="ask-cursor" aria-hidden="true">▍</span>}</>
}
const object=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null
function isSource(v:unknown):v is Source{return object(v)&&['id','title','text'].every(k=>typeof v[k]==='string'&&(v[k] as string).length>0)&&['project_guide','demo_learning_note','fictional_reference','owner_reference'].includes(String(v.kind))}
function isAnswer(v:unknown):v is Answer{
 if(!object(v)||!['answered','clarify','not_covered'].includes(String(v.status))||typeof v.message!=='string'||typeof v.reference_version!=='string'||v.persistence_status!=='not_saved'||!Array.isArray(v.sources)||v.sources.length>3||!v.sources.every(isSource))return false
 if(typeof v.context_token!=='string'||!Array.isArray(v.paragraphs)||v.paragraphs.length>3)return false
 if(v.answer_language!==undefined&&!Object.hasOwn(answerLanguages,String(v.answer_language)))return false
 if(v.speech_available!==undefined&&typeof v.speech_available!=='boolean')return false
 if(v.answer_mode!==undefined&&v.answer_mode!=='explanation'&&v.answer_mode!=='reference_excerpt')return false
 const sources=v.sources as Source[]
 if(!v.paragraphs.every((p:unknown)=>object(p)&&typeof p.text==='string'&&Array.isArray(p.evidence)&&p.evidence.length>0&&p.evidence.every((e:unknown)=>object(e)&&typeof e.source_id==='string'&&typeof e.quote==='string'&&sources.some(s=>s.id===e.source_id&&s.text.includes(e.quote as string)))))return false
 return (v.status==='answered')===(v.sources.length>0)&&(v.status==='answered')===(v.paragraphs.length>0)&&new Set(sources.map(s=>s.id)).size===sources.length
}
const sourceKind=(s:Source)=>({demo_learning_note:'Fictional demo learning note',project_guide:'Project guide',fictional_reference:'Fictional demo reference',owner_reference:'Owner-supplied reference · authenticity not independently verified'}[s.kind])
function errorMessage(v:unknown,status:number){return object(v)&&typeof v.detail==='string'?v.detail:`Question request failed (${status}).`}
export default function AskSentinel({active=true,onReport}:{active?:boolean;onReport?:()=>void}){
 const user=useAccount(),id=useId()
 const [following,setFollowing]=useState(true),[attachmentOpen,setAttachmentOpen]=useState(false),[voiceOpen,setVoiceOpen]=useState(false)
 const scope=useRef<HTMLSelectElement|null>(null)
 const scrollLatest=()=>{const el=log.current;if(el)el.scrollTo({top:el.scrollHeight,behavior:'smooth'})}
 const onProgress=()=>{if(following)scrollLatest()}
 const [answerLanguage,setAnswerLanguage]=useState<AnswerLanguage>('english')
 const [draft,setDraft]=useState(''),[turns,setTurns]=useState<Turn[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const [voiceBusy,setVoiceBusy]=useState(false),[voiceKey,setVoiceKey]=useState(0)
 const [machineId,setMachineId]=useState(''),[machineOptions,setMachineOptions]=useState<{machine_id:string;name:string;code:string;model:string;active:boolean}[]>([]),[machineBusy,setMachineBusy]=useState(false),[machineError,setMachineError]=useState('')
 const machineController=useRef<AbortController|null>(null)
 const [contextToken,setContextToken]=useState<string|null>(null)
 const [notes,setNotes]=useState<{version:string;sources:Source[]}|null>(null),[notesBusy,setNotesBusy]=useState(false),[notesError,setNotesError]=useState('')
 const controller=useRef<AbortController|null>(null),notesController=useRef<AbortController|null>(null),input=useRef<HTMLTextAreaElement|null>(null),log=useRef<HTMLDivElement|null>(null),serial=useRef(0)
 useEffect(()=>()=>{controller.current?.abort();controller.current=null;notesController.current?.abort();notesController.current=null;machineController.current?.abort();machineController.current=null},[])
 useEffect(()=>{if(following)scrollLatest()},[turns,following])
 const examples=user.role==='technician'?['What does work completed mean?','What does a motor do?','What does a compressor do?']:['What does REDLINE mean?','How do I correct a saved transcript?','What does a motor do?']
 async function loadMachines(){
  if(machineController.current)return
  const c=new AbortController();machineController.current=c;setMachineBusy(true);setMachineError('')
  const timer=window.setTimeout(()=>c.abort(),30000)
  try{
   const r=await apiFetch('/api/machine-references/machines',{signal:c.signal});const data:unknown=await r.json()
   if(!r.ok)throw new Error(errorMessage(data,r.status))
   if(!object(data)||!Array.isArray(data.machines)||!data.machines.every(m=>object(m)&&['machine_id','code','name','model'].every(k=>typeof m[k]==='string')&&typeof m.active==='boolean'))throw new Error('Unexpected machine options.')
   if(machineController.current===c&&!c.signal.aborted){
    const options=(data.machines as {machine_id:string;name:string;code:string;model:string;active:boolean}[]).filter(m=>m.active);setMachineOptions(options)
    if(machineId&&!options.some(m=>m.machine_id===machineId)){setMachineId('');setTurns([]);setContextToken(null);setNotes(null);setDraft('');setVoiceKey(k=>k+1);setMachineError('The selected machine is no longer available. The conversation was cleared.')}
   }
  }catch(e){if(machineController.current===c)setMachineError(c.signal.aborted?'Machine loading timed out.':e instanceof Error?e.message:'Could not load machine references.')}
  finally{window.clearTimeout(timer);if(machineController.current===c){machineController.current=null;setMachineBusy(false)}}
 }
 async function ask(e:FormEvent){
  e.preventDefault()
  const question=draft.trim()
  if(controller.current||voiceBusy||question.length<3||machineBusy)return
  const c=new AbortController();controller.current=c;setBusy(true);setError('')
  const timeout=window.setTimeout(()=>c.abort(),110000)
  try{
   const r=await apiFetch('/api/ask-sentinel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,...(answerLanguage==='english'?{}:{answer_language:answerLanguage}),context_token:contextToken,...(machineId?{machine_id:machineId}:{})}),signal:c.signal})
   const data:unknown=await r.json()
   if(!r.ok)throw new Error(errorMessage(data,r.status))
   if(!isAnswer(data)||(data.answer_language??'english')!==answerLanguage)throw new Error('The server returned an unexpected answer. No report was changed.')
   if(controller.current!==c||c.signal.aborted)return
   const turn={id:++serial.current,question,answer:data}
   setTurns(previous=>[...previous,turn].slice(-8));setContextToken(data.context_token);setDraft('');setVoiceKey(k=>k+1)
  }catch(e){if(controller.current===c)setError(c.signal.aborted?'The question timed out. Wait before asking again; the provider may have processed it.':e instanceof Error?e.message:'Could not answer the question.')}
  finally{window.clearTimeout(timeout);if(controller.current===c){controller.current=null;setBusy(false)}}
 }
 async function loadNotes(){
  if(notesController.current)return
  const c=new AbortController();notesController.current=c;setNotesBusy(true);setNotesError('')
  const timeout=window.setTimeout(()=>c.abort(),30000)
  try{
   const r=await apiFetch('/api/ask-sentinel/references'+(machineId?'?machine_id='+encodeURIComponent(machineId):''),{signal:c.signal});const data:unknown=await r.json()
   if(!r.ok)throw new Error(errorMessage(data,r.status))
   if(!object(data)||typeof data.version!=='string'||!Array.isArray(data.sources)||!data.sources.every(isSource))throw new Error('Unexpected reference response.')
   if(notesController.current===c&&!c.signal.aborted)setNotes({version:data.version,sources:data.sources})
  }catch(e){if(notesController.current===c)setNotesError(c.signal.aborted?'Reference loading timed out.':e instanceof Error?e.message:'Could not load reference notes.')}
  finally{window.clearTimeout(timeout);if(notesController.current===c){notesController.current=null;setNotesBusy(false)}}
 }
 return <section className="card ask-sentinel" aria-labelledby={`${id}-heading`}>
  <div className="ask-top"><div><p className="eyebrow">REFERENCE ASSISTANT</p><h2 id={`${id}-heading`}><span className="ask-avatar">X</span> Ask SENTINEL</h2></div><button type="button" className="secondary" disabled={busy||voiceBusy} onClick={()=>{setTurns([]);setContextToken(null);setDraft('');setError('');setVoiceKey(k=>k+1)}}>New chat</button></div>
  <details className="ask-settings"><summary>Answer language and reference scope · {answerLanguages[answerLanguage]}{machineId?" · Machine selected":""}</summary>
  <p>Ask a question about SENTINEL X or the demo machines. AI explains the reference notes and remembers recent exchanges for follow-up questions.</p>
  <p className="hint">Use the speaker button beside an answer to hear English, Hindi or Bengali answers through Gnani Timbre. The first click sends that answer for speech; replay uses the generated clip.</p>
  <p className="hint">General sources are project instructions and fictional demo notes. Choose a machine below to include matching owner-enabled reference documents. These texts are evidence, not independently verified approval or a safety certificate.</p>
  <label htmlFor={`${id}-answer-language`}>Answer language</label>
  <select id={`${id}-answer-language`} value={answerLanguage} disabled={busy}
    style={{display:'block',width:'100%',margin:'8px 0'}} onChange={e=>setAnswerLanguage(e.target.value as AnswerLanguage)}>
    {(Object.entries(answerLanguages) as [AnswerLanguage,string][]).map(([value,label])=><option key={value} value={value}>{label}</option>)}
  </select>
  <p className="hint">Applies to the next answer. Hinglish and Benglish answers are text only. Source quotations stay in their original language.</p>
  <label htmlFor={`${id}-machine`}>Reference scope</label>
  <select id={`${id}-machine`} ref={scope} value={machineId} disabled={busy||voiceBusy||notesBusy||machineBusy} style={{display:'block',width:'100%',margin:'8px 0'}} onChange={e=>{setMachineId(e.target.value);setTurns([]);setContextToken(null);setNotes(null);setNotesError('');setDraft('');setError('');setVoiceKey(k=>k+1)}}>
   <option value="">General project and demo notes</option>{machineOptions.map(m=><option key={m.machine_id} value={m.machine_id}>{m.name} · {m.code} · {m.model||'Model not recorded'}</option>)}
  </select>
  <button type="button" className="secondary" disabled={busy||voiceBusy||notesBusy||machineBusy} onClick={loadMachines}>{machineBusy?'Loading machines…':'Refresh available reference machines'}</button>
  {machineError&&<p role="alert" className="error">{machineError}</p>}
  <p className="hint">Changing scope clears this conversation, drafts and audio. Workers see assigned machines; technicians see machines in their assigned work. The model receives the selected reference text, not live reports. Reference changes or access changes can require a new conversation.</p>
  <details className="ask-library"><summary>Browse reference notes</summary>
   <button type="button" className="secondary" disabled={notesBusy} onClick={loadNotes}>{notesBusy?'Loading…':notes?'Refresh reference notes':'Load reference notes'}</button>
   {notesError&&<p className="error" role="alert">{notesError}</p>}
   {notes&&<><p className="hint">Reference version {notes.version}. Reading these notes makes no model request.</p>{notes.sources.map(s=><details key={s.id} className="ask-note"><summary>{s.title}</summary><p className="hint">{sourceKind(s)}</p><p>{s.text}</p></details>)}</>}
  </details>
  </details>
  {turns.length===0&&<div className="ask-examples" aria-label="Example questions">{examples.map(q=><button type="button" className="secondary" disabled={busy||voiceBusy} key={q} onClick={()=>{setDraft(q);input.current?.focus()}}>{q}</button>)}</div>}
  <div className="ask-log" ref={log} onScroll={e=>{const el=e.currentTarget;setFollowing(el.scrollHeight-el.scrollTop-el.clientHeight<90)}} role="log" aria-live="polite" aria-relevant="additions" aria-label="Questions and reference answers">
   {turns.length===0&&<div className="ask-welcome"><span className="ask-avatar" aria-hidden="true">X</span><div><strong>Hi, how can I help you today?</strong><p>Ask about SENTINEL X or the selected machine reference. I’ll show the source passages with my answer.</p></div></div>}
   {turns.map(turn=><article className="ask-turn" key={turn.id}>
    <div className="ask-question"><span className="eyebrow">YOU ASKED</span><p>{turn.question}</p></div>
    <div className="ask-answer"><div className="ask-answer-heading"><strong>Ask SENTINEL · {turn.answer.answer_mode==='reference_excerpt'?'Reference excerpts':answerLanguages[turn.answer.answer_language??'english']}</strong>{turn.answer.speech_available!==false&&<AnswerSpeaker key={turn.id} receipt={turn.answer.context_token} active={active} machineId={machineId||null}/>}</div><p>{turn.answer.message}</p>
     {turn.answer.paragraphs.map((p,index)=><div className="ask-passage" key={index}>
      <p><ProgressiveText text={p.text} onProgress={onProgress}/> {Array.from(new Set(p.evidence.map(e=>e.source_id))).map(sourceId=>{const i=turn.answer.sources.findIndex(s=>s.id===sourceId);return <a key={sourceId} className="ask-citation" href={`#${id}-turn${turn.id}-source${i}`}>[{i+1}] </a>})}</p>
     </div>)}
     {turn.answer.sources.length>0&&<details className="ask-sources"><summary>Sources and supporting quotes · {turn.answer.sources.length}</summary><ol>{turn.answer.sources.map((s,i)=><li id={`${id}-turn${turn.id}-source${i}`} key={s.id}><strong>{s.title}</strong><span>{sourceKind(s)} · reference version {turn.answer.reference_version}</span>
      {Array.from(new Set(turn.answer.paragraphs.flatMap(p=>p.evidence.filter(e=>e.source_id===s.id).map(e=>e.quote)))).map(quote=><blockquote key={quote}>{quote}</blockquote>)}
      <details><summary>Read full reference passage</summary><p>{s.text}</p></details>
     </li>)}</ol><p className="hint">This explanation is AI-generated. Check that the cited passages support its meaning; a valid citation alone does not prove an answer is correct.</p></details>}

    </div>
   </article>)}
  </div>
  <div className="ask-composer-dock">
  {!following&&turns.length>0&&<button className="secondary ask-jump" type="button" onClick={()=>{setFollowing(true);scrollLatest()}}>↓ Latest</button>}
  {attachmentOpen&&<div className="ask-add-menu"><button type="button" onClick={()=>{setAttachmentOpen(false);onReport?.()}}>＋ Add photo or file to a report</button><button type="button" onClick={()=>{setAttachmentOpen(false);scope.current?.focus()}}>▤ Choose reference scope</button></div>}
  <form onSubmit={ask} className="ask-form" aria-busy={busy}>
   {voiceOpen&&<VoiceQuestion key={voiceKey} active={active} disabled={busy} onBusy={setVoiceBusy} onUse={text=>{setDraft(text);input.current?.focus()}}/>}
   <div className="ask-compose-row"><button type="button" className="secondary ask-icon" aria-label="Add" aria-expanded={attachmentOpen} onClick={()=>setAttachmentOpen(v=>!v)}>＋</button>
   <label className="ask-visually-hidden" htmlFor={`${id}-question`}>Your question · review before asking</label>
   <textarea id={`${id}-question`} ref={input} rows={3} maxLength={1200} value={draft} disabled={busy||voiceBusy} placeholder="For example: What does REDLINE mean?" onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();e.currentTarget.form?.requestSubmit()}}} aria-describedby={`${id}-privacy`}/>
   <button type="button" className="secondary ask-icon" aria-label="Record a question" aria-expanded={voiceOpen} onClick={()=>setVoiceOpen(v=>!v)}>🎙</button>
   <button className="ask-icon ask-submit" aria-label="Ask SENTINEL" disabled={busy||voiceBusy||machineBusy||draft.trim().length<3}>➤</button></div>
   <div className="ask-form-footer"><span className="hint">{draft.length}/1,200 characters</span><span className="hint">{busy?'Preparing explanation…':'Enter to ask · Shift+Enter for a new line'}</span></div>
   <p id={`${id}-privacy`} className="hint">Asking sends this question, up to four recent exchanges, general notes and any enabled documents for the selected machine to the configured answer provider. Use a new conversation to clear follow-up context. The app attaches no live report, account list or repair record.</p>
  </form></div>
  {busy&&<p role="status">Preparing a sourced explanation. Your reports stay unchanged.</p>}
  {error&&<p className="error" role="alert">{error}</p>}
  {turns.length>0&&<button type="button" className="secondary ask-clear" disabled={busy||voiceBusy} onClick={()=>{setTurns([]);setContextToken(null);setDraft('');setError('');setVoiceKey(k=>k+1)}}>Start a new conversation</button>}
  <p className="hint">Up to eight exchanges stay on this page; up to four provide follow-up context. Context expires after 30 minutes of inactivity. Refreshing, signing out or starting a new conversation clears it. Ask SENTINEL does not change reports, assignments, escalations or work status.</p>

 </section>
}

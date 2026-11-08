import { useEffect, useId, useRef, useState } from 'react'
import MicrophoneRecorder from './MicrophoneRecorder'
import { apiFetch } from './api'

type Props={active:boolean;disabled:boolean;onBusy:(busy:boolean)=>void;onUse:(text:string)=>void}
export default function VoiceQuestion({active,disabled,onBusy,onUse}:Props){
 const id=useId(),[file,setFile]=useState<File|null>(null),[inputKey,setInputKey]=useState(0)
 const [mode,setMode]=useState('auto'),[recording,setRecording]=useState(false),[busy,setBusy]=useState(false)
 const [text,setText]=useState(''),[language,setLanguage]=useState<string|null>(null),[error,setError]=useState(''),[url,setUrl]=useState('')
 const controller=useRef<AbortController|null>(null),audio=useRef<HTMLAudioElement|null>(null)
 const locked=disabled||recording||busy
 useEffect(()=>{onBusy(recording||busy)},[recording,busy,onBusy])
 useEffect(()=>()=>{controller.current?.abort();controller.current=null;onBusy(false)},[onBusy])
 useEffect(()=>{if(!file){setUrl('');return}const next=URL.createObjectURL(file);setUrl(next);return()=>URL.revokeObjectURL(next)},[file])
 useEffect(()=>{if(!active)audio.current?.pause()},[active])
 useEffect(()=>{
  const pause=(e:Event)=>{if((e as CustomEvent<string>).detail!==id)audio.current?.pause()}
  window.addEventListener('sentinel-readback-playing',pause)
  return()=>{audio.current?.pause();window.removeEventListener('sentinel-readback-playing',pause)}
 },[id])
 function choose(next:File|null){
  setText('');setLanguage(null);setError('')
  if(next&&(!/\.(wav|mp3|m4a|ogg|flac|aac)$/i.test(next.name)||next.size===0||next.size>10*1024*1024)){
   setFile(null);setError('Choose a nonempty WAV, MP3, M4A, OGG, FLAC or AAC file up to 10 MiB.');return
  }
  setFile(next)
 }
 async function transcribe(){
  if(!file||locked||controller.current)return
  audio.current?.pause();setText('');setLanguage(null);setError('');setBusy(true)
  const c=new AbortController();controller.current=c
  const timer=window.setTimeout(()=>c.abort(),80000)
  try{
   const body=new FormData();body.append('audio',file);body.append('speaking_mode',mode)
   const response=await apiFetch('/api/ask-sentinel/transcribe',{method:'POST',body,signal:c.signal})
   const data:unknown=await response.json()
   const value=data as {detail?:unknown;transcript?:unknown;detected_language_code?:unknown;persistence_status?:unknown}
   if(!response.ok)throw new Error(value&&typeof value.detail==='string'?value.detail:`Transcription failed (${response.status}).`)
   if(!value||typeof value.transcript!=='string'||!value.transcript.trim()||value.transcript.length>1200||value.persistence_status!=='not_saved'||!(value.detected_language_code===null||typeof value.detected_language_code==='string'))throw new Error('Unexpected transcription response. Try again later.')
   if(controller.current!==c||c.signal.aborted)return
   setText(value.transcript);setLanguage(typeof value.detected_language_code==='string'?value.detected_language_code:null)
  }catch(e){if(controller.current===c)setError(c.signal.aborted?'Transcription timed out. Wait before trying again; Gnani may have processed it.':e instanceof Error?e.message:'Could not transcribe this question.')}
  finally{window.clearTimeout(timer);if(controller.current===c){controller.current=null;setBusy(false)}}
 }
 return <section className="voice-question" aria-labelledby={`${id}-heading`}>
  <h3 id={`${id}-heading`}>Ask with your voice</h3>
  <p className="hint">Upload or record a short question, up to 30 seconds and 10 MiB. Nothing is sent until you click Transcribe question. This creates no maintenance report.</p>
  <label htmlFor={`${id}-language`}>Speaking language</label>
  <select id={`${id}-language`} disabled={locked} value={mode} onChange={e=>{setMode(e.target.value);setText('');setLanguage(null)}}>
   <option value="auto">Automatic detection</option><option value="english">English</option><option value="hindi">Hindi / हिन्दी</option><option value="bengali">Bengali / বাংলা</option><option value="hinglish">Hinglish / Hindi + English</option><option value="benglish">Benglish / Bengali + English</option>
  </select>
  <p className="hint">This hints the spoken language; it does not translate the question. Chat answers remain in English.</p>
  <MicrophoneRecorder active={active} disabled={disabled||busy} onBusy={setRecording} onFile={next=>{choose(next);setInputKey(k=>k+1)}}/>
  <label htmlFor={`${id}-file`}>Or upload a question recording</label>
  <input key={inputKey} id={`${id}-file`} type="file" accept=".wav,.mp3,.m4a,.ogg,.flac,.aac" disabled={locked} onChange={e=>choose(e.target.files?.[0]??null)}/>
  {file&&url&&<><p className="hint">Selected: {file.name}</p><audio ref={audio} controls src={url} aria-label="Question recording playback" onPlay={()=>window.dispatchEvent(new CustomEvent('sentinel-readback-playing',{detail:id}))}/></>}
  <button type="button" className="secondary" disabled={locked||!file} onClick={transcribe}>{busy?'Transcribing question…':'Transcribe question'}</button>
  {busy&&<p role="status">Sending this recording to Gnani Prisma. Review the text before asking.</p>}
  {error&&<p role="alert" className="error">{error}</p>}
  {text&&<div className="voice-question-review"><strong>What Gnani heard</strong><p>{text}</p><p className="hint">Detected language: {language??'Not returned'}. Check names, numbers and meaning.</p><button type="button" disabled={locked} onClick={()=>onUse(text)}>Use this text in my question</button><p className="hint">This replaces the question box below. Edit it there, then click Ask SENTINEL. It is not sent to the chatbot automatically.</p></div>}
  {file&&<button type="button" className="secondary" disabled={locked} onClick={()=>{choose(null);setInputKey(k=>k+1)}}>Clear question recording</button>}
  <p className="hint">The app keeps the recording and draft on this page only. A successful question, starting a new conversation, refreshing or signing out clears them. Transcription sends audio to Gnani; asking sends the reviewed text to the answer provider.</p>
 </section>
}

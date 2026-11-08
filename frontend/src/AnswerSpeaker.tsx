import { useEffect,useId,useRef,useState } from 'react'
import { apiFetch } from './api'
export default function AnswerSpeaker({receipt,active=true,machineId=null}:{receipt:string;active?:boolean;machineId?:string|null}){
 const id=useId(),audio=useRef<HTMLAudioElement|null>(null),controller=useRef<AbortController|null>(null),objectUrl=useRef(''),playOnReady=useRef(false),visible=useRef(active)
 const [url,setUrl]=useState(''),[busy,setBusy]=useState(false),[playing,setPlaying]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 visible.current=active
 useEffect(()=>{
  const stopOthers=(event:Event)=>{if((event as CustomEvent<string>).detail!==id)audio.current?.pause()}
  window.addEventListener('sentinel-readback-playing',stopOthers)
  return()=>{window.removeEventListener('sentinel-readback-playing',stopOthers);controller.current?.abort();controller.current=null;audio.current?.pause();if(objectUrl.current)URL.revokeObjectURL(objectUrl.current)}
 },[id])
 useEffect(()=>{if(!active){playOnReady.current=false;audio.current?.pause()}},[active])
 async function play(){
  if(!visible.current||!audio.current)return
  try{await audio.current.play();setNotice('')}
  catch{setNotice('Audio is ready. Press Play in the audio controls.')}
 }
 useEffect(()=>{if(url&&playOnReady.current){playOnReady.current=false;void play()}},[url])
 async function toggle(){
  if(controller.current)return
  if(url){if(audio.current&&!audio.current.paused)audio.current.pause();else await play();return}
  setError('');setNotice('');setBusy(true)
  const c=new AbortController();controller.current=c
  const timer=window.setTimeout(()=>c.abort(),90000)
  try{
   const r=await apiFetch('/api/ask-sentinel/readback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context_token:receipt,...(machineId?{machine_id:machineId}:{})}),signal:c.signal})
   if(!r.ok){const d:unknown=await r.json();throw new Error(d&&typeof d==='object'&&'detail' in d&&typeof d.detail==='string'?d.detail:`Speech request failed (${r.status}).`)}
   const blob=await r.blob()
   if(blob.size===0||blob.size>12*1024*1024||!blob.type.includes('audio/wav'))throw new Error('Unexpected speech audio response.')
   if(controller.current!==c||c.signal.aborted)return
   objectUrl.current=URL.createObjectURL(blob);playOnReady.current=visible.current;setUrl(objectUrl.current)
  }catch(e){if(controller.current===c)setError(c.signal.aborted?'Speech generation timed out. Wait before trying again.':e instanceof Error?e.message:'Could not generate speech.')}
  finally{window.clearTimeout(timer);if(controller.current===c){controller.current=null;setBusy(false)}}
 }
 const label=busy?'Generating answer audio':playing?'Pause answer audio':url?'Play answer audio':'Read answer aloud'
 return <div className="answer-speaker">
  <button type="button" className="secondary answer-speaker-button" disabled={busy} onClick={toggle} aria-label={label} title={label} aria-busy={busy}>
   {playing?<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>:<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4 6 8H3v8h3l5 4V4Z"/><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></svg>}
  </button>
  {busy&&<span className="answer-speaker-status" role="status">Generating speech…</span>}
  {url&&<audio ref={audio} controls src={url} preload="metadata" aria-label="Spoken chatbot answer" onPlay={()=>{setPlaying(true);window.dispatchEvent(new CustomEvent('sentinel-readback-playing',{detail:id}))}} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)}/>}
  {notice&&<span className="answer-speaker-status" role="status">{notice}</span>}
  {error&&<p className="error" role="alert">{error}</p>}
 </div>
}

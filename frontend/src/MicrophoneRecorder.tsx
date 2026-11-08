import { useEffect,useRef,useState } from 'react'
import { encodeWav } from './audioWav'
export default function MicrophoneRecorder({disabled,active,onFile,onBusy}:{disabled:boolean;active:boolean;onFile:(file:File)=>void;onBusy:(busy:boolean)=>void}){
 const [phase,setPhase]=useState<'idle'|'permission'|'recording'|'processing'>('idle'),[seconds,setSeconds]=useState(0),[error,setError]=useState(''),[noiseSuppression,setNoiseSuppression]=useState(true),[noiseStatus,setNoiseStatus]=useState('')
 const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),chunks=useRef<Blob[]>([]),mounted=useRef(true),visible=useRef(active),working=useRef(false)
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null),ticker=useRef<ReturnType<typeof setInterval>|null>(null)
 const callbacks=useRef({onFile,onBusy});callbacks.current={onFile,onBusy};visible.current=active
 function clearTimers(){if(timer.current)clearTimeout(timer.current);if(ticker.current)clearInterval(ticker.current);timer.current=null;ticker.current=null}
 function tracksOff(){stream.current?.getTracks().forEach(t=>t.stop());stream.current=null}
 function finish(){clearTimers();tracksOff();working.current=false;if(mounted.current){setPhase('idle');callbacks.current.onBusy(false)}}
 function stop(){clearTimers();if(recorder.current?.state==='recording'){if(mounted.current)setPhase('processing');recorder.current.stop();tracksOff()}}
 useEffect(()=>{if(!active)stop()},[active])
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;clearTimers();if(recorder.current){recorder.current.onstop=null;recorder.current.ondataavailable=null;recorder.current.onerror=null;if(recorder.current.state==='recording')recorder.current.stop()}tracksOff()}},[])
 async function start(){
  if(disabled||working.current)return
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setError('Microphone recording is unavailable in this browser. You can still upload a file.');return}
  working.current=true;setError('');setSeconds(0);setPhase('permission');callbacks.current.onBusy(true)
  try{
   const input=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression,autoGainControl:true},video:false})
   stream.current=input
   const applied=input.getAudioTracks()[0]?.getSettings().noiseSuppression
   setNoiseStatus(applied===true?'Microphone noise suppression is enabled.':applied===false?'Microphone noise suppression is off.':'This browser does not report its noise suppression setting.')
   if(!mounted.current||!visible.current){finish();return}
   const options=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t))
   const rec=new MediaRecorder(input,options?{mimeType:options}:undefined);recorder.current=rec;chunks.current=[]
   rec.ondataavailable=e=>{if(e.data.size)chunks.current.push(e.data)}
   rec.onerror=()=>{rec.onstop=null;if(mounted.current)setError('Recording failed. Please try again or upload a file.');if(rec.state==='recording')rec.stop();finish()}
   rec.onstop=async()=>{
    if(!mounted.current){finish();return}
    setPhase('processing');clearTimers();tracksOff()
    let context:AudioContext|null=null
    try{
     const blob=new Blob(chunks.current,{type:rec.mimeType});if(!blob.size)throw new Error('No audio was captured. Try a longer recording.')
     context=new AudioContext();const decoded=await context.decodeAudioData(await blob.arrayBuffer())
     const channels=Array.from({length:decoded.numberOfChannels},(_,i)=>decoded.getChannelData(i))
     const wav=encodeWav(channels,decoded.sampleRate)
     if(mounted.current)callbacks.current.onFile(new File([wav],`sentinel-recording-${Date.now()}.wav`,{type:'audio/wav'}))
    }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Could not prepare recorded audio.')}
    finally{if(context)await context.close().catch(()=>{});finish()}
   }
   rec.start(250);setPhase('recording');const started=Date.now()
   ticker.current=setInterval(()=>{if(mounted.current)setSeconds(Math.min(30,Math.floor((Date.now()-started)/1000)))},250)
   timer.current=setTimeout(stop,30000)
  }catch(e){if(mounted.current)setError(e instanceof DOMException&&e.name==='NotAllowedError'?'Microphone permission was denied. Allow microphone access for this local site, or upload a file.':'Could not access your microphone. Check your device and browser permissions.');finish()}
 }
 return <section className={`recorder-panel recorder-${phase}`} aria-label="Microphone recording" style={{margin:'16px 0',border:'1px solid #64748b',borderRadius:8,padding:14}}>
  <div className="recorder-heading"><span className="recorder-symbol" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8"/></svg></span><div><h3>Record your report</h3><span>Speak naturally · Up to 30 seconds</span></div></div><p className="hint">Up to 30 seconds. Recording stays in this browser until you click Transcribe. Switching views stops an active recording and prepares it for review.</p>
  <label><input type="checkbox" checked={noiseSuppression} disabled={disabled||phase!=='idle'} onChange={event=>setNoiseSuppression(event.target.checked)}/> Reduce background noise</label>
  <p className="hint">Keep the microphone near your mouth. Replay and check machine names, numbers, units and negation. If speech is unclear, use a typed report.</p>
  {noiseStatus&&<p role="status" className="hint">{noiseStatus}</p>}
  <button type="button" disabled={disabled||phase!=='idle'} onClick={start}><span aria-hidden="true">● </span>Start recording</button>
  {phase==='recording'&&<button type="button" className="secondary" onClick={stop}>Stop recording · {seconds}s / 30s</button>}
  {phase==='permission'&&<p role="status">Waiting for microphone permission…</p>}{phase==='processing'&&<p role="status">Preparing your WAV recording…</p>}
  {error&&<p role="alert" className="error">{error}</p>}
 </section>
}
export function AudioPreview({file}:{file:File|null}){
 const [url,setUrl]=useState('')
 useEffect(()=>{if(!file){setUrl('');return}const next=URL.createObjectURL(file);setUrl(next);return()=>URL.revokeObjectURL(next)},[file])
 return file&&url?<div><p className="hint">Selected recording: {file.name}</p><audio controls src={url} style={{width:'100%'}} aria-label="Selected recording playback"/></div>:null
}

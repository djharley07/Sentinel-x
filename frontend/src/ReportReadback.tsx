import { useEffect,useId,useRef,useState } from 'react'
import { apiFetch } from './api'

const languages=[['auto','Automatic / mixed script'],['en-IN','English'],['hi-IN','Hindi / हिन्दी'],['bn-IN','Bengali / বাংলা'],['hi-en','Hinglish'],['ta-IN','Tamil'],['te-IN','Telugu'],['kn-IN','Kannada'],['ml-IN','Malayalam'],['mr-IN','Marathi'],['pa-IN','Punjabi'],['gu-IN','Gujarati']]
export default function ReportReadback({attemptId,active=true,previewText}:{attemptId:string;active?:boolean;previewText?:string}){
 const [language,setLanguage]=useState('auto'),[url,setUrl]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const controller=useRef<AbortController|null>(null),audio=useRef<HTMLAudioElement|null>(null),objectUrl=useRef('')
 const id=useId()
 useEffect(()=>{
  const stopOthers=(event:Event)=>{if((event as CustomEvent<string>).detail!==id)audio.current?.pause()}
  window.addEventListener('sentinel-readback-playing',stopOthers)
  return()=>{window.removeEventListener('sentinel-readback-playing',stopOthers);controller.current?.abort();controller.current=null;audio.current?.pause();if(objectUrl.current)URL.revokeObjectURL(objectUrl.current)}
 },[id])
 useEffect(()=>{if(!active)audio.current?.pause()},[active])
 function clearAudio(){audio.current?.pause();if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);objectUrl.current='';setUrl('')}
 async function generate(){
  if(controller.current)return
  clearAudio();setBusy(true);setError('');const c=new AbortController();controller.current=c;const timer=window.setTimeout(()=>c.abort(),90000)
  try{
   const r=await apiFetch(`/api/attempts/${attemptId}/${previewText===undefined?'readback':'preview-readback'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(previewText===undefined?{language}:{language,text:previewText}),signal:c.signal})
   if(!r.ok){const d:unknown=await r.json();throw new Error(d&&typeof d==='object'&&'detail' in d&&typeof d.detail==='string'?d.detail:`Read-back failed (${r.status}).`)}
   const blob=await r.blob()
   if(blob.size===0||blob.size>12*1024*1024||!blob.type.includes('audio/wav'))throw new Error('Unexpected audio response.')
   if(controller.current!==c||c.signal.aborted)return
   objectUrl.current=URL.createObjectURL(blob);setUrl(objectUrl.current)
  }catch(e){if(controller.current===c)setError(c.signal.aborted?'Audio generation timed out. Wait before trying again.':e instanceof Error?e.message:'Could not generate speech.')}
  finally{window.clearTimeout(timer);if(controller.current===c){controller.current=null;setBusy(false)}}
 }
 return <section aria-label="Reviewed report read-back" style={{borderTop:'1px solid #475569',paddingTop:16,marginTop:16}}>
  <h4>{previewText===undefined?'Listen to the reviewed report':'Listen before confirming'}</h4>
  <p className="hint">{previewText===undefined?'Reads the saved, reviewed text above.':'Reads your current draft. This text has not been confirmed.'} Choosing a language does not translate it. For Bengali–English mixed script, use Automatic; pronunciation needs checking.</p>
  <label>Language of the existing text<select style={{display:'block',width:'100%',marginTop:6}} disabled={busy} value={language} onChange={e=>{setLanguage(e.target.value);clearAudio();setError('')}}>{languages.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
  <button className="secondary" disabled={busy||(previewText?.length??0)>1500} onClick={generate}>{busy?'Generating audio…':url?'Generate again':'Generate read-back audio'}</button>
  <p className="hint">Generating sends this {previewText===undefined?'reviewed transcript':'unconfirmed draft'} to Gnani Timbre v3.0. Replaying the generated clip does not send another request. Check equipment names, numbers, units and negation against the text; spoken output can make mistakes.</p>
  {(previewText?.length??0)>1500&&<p className="hint">Draft read-back supports up to 1,500 characters. You can still review the full text manually.</p>}
  {error&&<p className="error" role="alert">{error}</p>}
  {url&&<audio ref={audio} controls preload="metadata" src={url} style={{width:'100%'}} onPlay={()=>window.dispatchEvent(new CustomEvent('sentinel-readback-playing',{detail:id}))}/>}
 </section>
}

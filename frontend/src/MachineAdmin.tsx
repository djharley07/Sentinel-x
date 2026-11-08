import { useEffect,useId,useRef,useState,type FormEvent } from 'react'
import { apiFetch } from './api'
import './MachineAdmin.css'
type Machine={machine_id:string;code:string;name:string;department:string;manufacturer:string;model:string;last_service_date:string|null;active:boolean;revision:number}
type Edit=Omit<Machine,'machine_id'|'revision'>&{machine_id:string|null;revision:number|null}
type Event={event_id:string;revision:number;reason:string;before:Machine|null;after:Machine;created_at:string;actor:string}
type Page={machines:Machine[];has_more:boolean;offset:number;limit:number}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'
function isMachine(v:unknown):v is Machine{return obj(v)&&['machine_id','code','name','department','manufacturer','model'].every(k=>typeof v[k]==='string')&&(v.last_service_date===null||typeof v.last_service_date==='string')&&typeof v.active==='boolean'&&Number.isInteger(v.revision)&&(v.revision as number)>0}
function isEvent(v:unknown):v is Event{return obj(v)&&['event_id','reason','created_at','actor'].every(k=>typeof v[k]==='string')&&Number.isInteger(v.revision)&&isMachine(v.after)&&(v.before===null||isMachine(v.before))}
const blank=():Edit=>({machine_id:null,revision:null,code:'',name:'',department:'',manufacturer:'',model:'',last_service_date:null,active:true})
const fields=[['code','Machine code'],['name','Machine name'],['department','Department'],['manufacturer','Manufacturer'],['model','Model']] as const
export default function MachineAdmin(){
 const id=useId(),[page,setPage]=useState<Page|null>(null),[filter,setFilter]=useState('all'),[offset,setOffset]=useState(0)
 const [edit,setEdit]=useState<Edit>(blank),[reason,setReason]=useState(''),[history,setHistory]=useState<Event[]|null>(null)
 const [busy,setBusy]=useState(false),[pending,setPending]=useState<string|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const controller=useRef<AbortController|null>(null)
 useEffect(()=>()=>{controller.current?.abort();controller.current=null},[])
 const locked=busy||pending!==null
 function reset(){setEdit(blank());setReason('');setHistory(null);setError('');setNotice('')}
 async function run(kind:'list'|'detail'|'save',target?:string,nextOffset=offset){
  if(controller.current)return
  const c=new AbortController();controller.current=c;setBusy(true);setError('');setNotice('')
  const timer=window.setTimeout(()=>c.abort(),30000)
  try{
   const body=kind==='save'?(pending??JSON.stringify({request_id:crypto.randomUUID(),machine_id:edit.machine_id,expected_revision:edit.revision,code:edit.code,name:edit.name,department:edit.department,manufacturer:edit.manufacturer,model:edit.model,last_service_date:edit.last_service_date,active:edit.active,reason:reason.trim()})):undefined
   if(body)setPending(body)
   const url=kind==='list'?`/api/machine-admin?status=${filter}&offset=${nextOffset}&limit=20`:kind==='detail'?`/api/machine-admin/${target}`:'/api/machine-admin'
   const r=await apiFetch(url,{method:kind==='save'?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body,signal:c.signal})
   const data:unknown=await r.json()
   if(controller.current!==c||c.signal.aborted)return
   if(!r.ok){if(kind==='save'&&[403,404,409,422].includes(r.status))setPending(null);throw new Error(obj(data)&&typeof data.detail==='string'?data.detail:`Machine request failed (${r.status}). Check the fields and reload before trying again.`)}
   if(kind==='list'){
    if(!obj(data)||!Array.isArray(data.machines)||!data.machines.every(isMachine)||typeof data.has_more!=='boolean'||data.offset!==nextOffset||data.limit!==20)throw new Error('Unexpected machine directory response.')
    setPage(data as Page);setOffset(nextOffset)
   }else{
    if(!obj(data)||!isMachine(data.machine))throw new Error('Unexpected machine details response.')
    if(kind==='detail'&&(!Array.isArray(data.history)||!data.history.every(isEvent)))throw new Error('Unexpected machine history response.')
    setEdit(data.machine);setReason('');setHistory(kind==='detail'?data.history as Event[]:null)
    if(kind==='save'){setPending(null);setPage(null);setNotice('Machine saved. Refresh the directory or load its change history below.')}
   }
  }catch(e){if(controller.current===c)setError(c.signal.aborted?'Request timed out. If saving, retry the same change to confirm its result.':e instanceof Error?e.message:'Could not load or save machines.')}
  finally{window.clearTimeout(timer);if(controller.current===c){controller.current=null;setBusy(false)}}
 }
 function submit(e:FormEvent){e.preventDefault();if(!locked)void run('save')}
 return <section className="card machine-admin" aria-labelledby={`${id}-heading`}>
  <p className="eyebrow">OWNER WORKSPACE / MACHINES</p><h2 id={`${id}-heading`}>Factory machines</h2>
  <p>Maintain machine identity, model and last service date. Inactive machines keep their reports and assignments, but cannot receive new assignments or new report links.</p>
  <p className="hint">Names, codes and departments shown elsewhere use current directory details. Original transcripts and reviewed facts stay unchanged; this page preserves earlier directory details in its change history. A service date is an owner-entered record, not proof of safe operation.</p>
  <div className="machine-admin-toolbar"><label htmlFor={`${id}-filter`}>Show machines<select id={`${id}-filter`} value={filter} disabled={locked} onChange={e=>{setFilter(e.target.value);setPage(null);setOffset(0)}}><option value="all">All machines</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
   <button type="button" className="secondary" disabled={locked} onClick={()=>run('list')}>Refresh directory</button><button type="button" className="secondary" disabled={locked} onClick={reset}>Add a machine</button></div>
  {page&&<><div className="machine-admin-table"><table><thead><tr><th>Machine</th><th>Department</th><th>Status</th><th>Last service</th><th>Details</th></tr></thead><tbody>{page.machines.map(m=><tr key={m.machine_id}><td><strong>{m.name}</strong><br/>{m.code}</td><td>{m.department}</td><td>{m.active?'Active':'Inactive'}</td><td>{m.last_service_date??'Not recorded'}</td><td><button type="button" className="secondary" disabled={locked} onClick={()=>run('detail',m.machine_id)}>Edit / history</button></td></tr>)}</tbody></table></div>
   {page.machines.length===0&&<p>No machines match this filter.</p>}
   <div className="machine-admin-toolbar"><button type="button" className="secondary" disabled={locked||offset===0} onClick={()=>run('list',undefined,Math.max(0,offset-20))}>Previous machines</button><button type="button" className="secondary" disabled={locked||!page.has_more} onClick={()=>run('list',undefined,offset+20)}>Next machines</button></div></>}
  {error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {pending&&<><p className="hint">The submitted fields are locked until saving is confirmed. Retry sends the same change identifier and values.</p><button type="button" disabled={busy} onClick={()=>run('save')}>Retry same machine change</button></>}
  <form onSubmit={submit}><h3>{edit.machine_id?`Edit ${edit.code} · version ${edit.revision}`:'Create a machine'}</h3>
   <fieldset disabled={locked}><div className="machine-admin-fields">{fields.map(([key,label])=><label key={key} htmlFor={`${id}-${key}`}>{label}{(key==='manufacturer'||key==='model')?' (optional)':''}<input id={`${id}-${key}`} required={key!=='manufacturer'&&key!=='model'} maxLength={key==='code'?64:120} pattern={key==='code'?'[A-Za-z0-9][A-Za-z0-9._-]*':undefined} value={edit[key]} onChange={e=>setEdit({...edit,[key]:e.target.value})}/></label>)}</div>
    <p className="hint">Codes are unique in this factory and saved in uppercase. Use letters, numbers, dots, underscores or hyphens. Leave unknown manufacturer and model fields blank.</p>
    <label htmlFor={`${id}-service`}>Last service date (optional)<input id={`${id}-service`} type="date" value={edit.last_service_date??''} onChange={e=>setEdit({...edit,last_service_date:e.target.value||null})}/></label>
    <label className="machine-admin-check"><input type="checkbox" checked={edit.active} onChange={e=>setEdit({...edit,active:e.target.checked})}/>Active in the machine directory</label>
    <p className="hint">Changing this status does not send an alert, stop equipment, close work or remove worker assignments. After a change, refresh other machine selectors. Use Worker machines to assign or remove workers.</p>
    <label htmlFor={`${id}-reason`}>Reason for creating or changing this record<textarea id={`${id}-reason`} required maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <button disabled={!edit.code.trim()||!edit.name.trim()||!edit.department.trim()||!reason.trim()}>{busy?'Saving…':edit.machine_id?'Save machine changes':'Create machine'}</button>
   </fieldset>
  </form>
  {edit.machine_id&&<><button type="button" className="secondary" disabled={locked} onClick={()=>run('detail',edit.machine_id!)}>Reload saved details and history</button><p className="hint">Reload replaces any unsaved edits in this form.</p></>}
  {history&&<details open><summary>Machine change history · Latest 20</summary>{history.length===0?<p>No directory changes have been recorded since machine management was installed.</p>:history.map(e=><article className="machine-admin-event" key={e.event_id}><strong>Version {e.revision} · {e.before?'Updated':'Created'}</strong><p>{e.reason}</p><p className="hint">{e.actor} · {new Date(e.created_at).toLocaleString()}</p><div className="machine-admin-table"><table><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>{[...fields,['last_service_date','Last service'],['active','Directory status']].map(([key,label])=>{const k=key as keyof Machine;const display=(m:Machine|null)=>m===null?'—':k==='active'?(m.active?'Active':'Inactive'):String(m[k]??'Not recorded')||'Not recorded';return <tr key={key}><td>{label}</td><td>{display(e.before)}</td><td>{display(e.after)}</td></tr>})}</tbody></table></div></article>)}</details>}
 </section>
}

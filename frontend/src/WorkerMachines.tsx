import { useEffect,useRef,useState } from 'react'
import { apiFetch } from './api'
import { useAccount } from './Auth'
import './WorkerMachines.css'
type Machine={machine_id:string;code:string;name:string;department:string;machine_active:boolean}
type State={worker_id:string;worker_name:string;worker_enabled:boolean;machines:(Machine&{event_id:string;active:boolean;note:string;created_at:string;assigned_by:string})[];history:{event_id:string;machine_name:string;active:boolean;note:string;created_at:string;actor:string}[]}
type Options={workers:{worker_id:string;username:string;name:string;enabled:boolean}[];machines:Machine[];workers_truncated:boolean}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'
const strings=(v:unknown,keys:string[])=>object(v)&&keys.every(k=>typeof v[k]==='string')
function stateValid(v:unknown):v is State{return object(v)&&strings(v,['worker_id','worker_name'])&&typeof v.worker_enabled==='boolean'&&Array.isArray(v.machines)&&v.machines.every(m=>strings(m,['machine_id','code','name','department','event_id','note','created_at','assigned_by'])&&object(m)&&typeof m.active==='boolean'&&typeof m.machine_active==='boolean')&&Array.isArray(v.history)&&v.history.every(e=>strings(e,['event_id','machine_name','note','created_at','actor'])&&object(e)&&typeof e.active==='boolean')}
function optionsValid(v:unknown):v is Options{return object(v)&&typeof v.workers_truncated==='boolean'&&Array.isArray(v.workers)&&v.workers.every(w=>strings(w,['worker_id','username','name'])&&object(w)&&typeof w.enabled==='boolean')&&Array.isArray(v.machines)&&v.machines.every(m=>strings(m,['machine_id','code','name','department'])&&object(m)&&typeof m.machine_active==='boolean')}
export default function WorkerMachines(){
 const account=useAccount(),owner=account.role==='owner'
 const [options,setOptions]=useState<Options|null>(null),[worker,setWorker]=useState(owner?'':account.account_id),[data,setData]=useState<State|null>(null),[machine,setMachine]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<string|null>(null)
 const active=useRef<AbortController|null>(null)
 useEffect(()=>()=>{active.current?.abort();active.current=null},[])
 const locked=busy||pending!==null
 async function run(mode:'options'|'load'|'assign'|'remove'){
  if(active.current)return
  const saving=mode==='assign'||mode==='remove'
  if(mode!=='options'&&!worker){setError('Choose a worker first.');return}
  if(saving&&!pending&&(!machine||!note.trim())){setError('Choose a machine and enter an assignment note.');return}
  const c=new AbortController();active.current=c;setBusy(true);setError('');const timer=window.setTimeout(()=>c.abort(),30000)
  try{
   const previous=data?.machines.find(m=>m.machine_id===machine)
   const body=saving?(pending??JSON.stringify({request_id:crypto.randomUUID(),previous_event_id:previous?.event_id??null,worker_id:worker,machine_id:machine,active:mode==='assign',note:note.trim()})):undefined
   if(saving)setPending(body!)
   const url=mode==='options'?'/api/worker-machine-options':saving?'/api/worker-machines':`/api/worker-machines?worker_id=${worker}`
   const r=await apiFetch(url,{method:saving?'POST':'GET',headers:saving?{'Content-Type':'application/json'}:undefined,body,signal:c.signal});const d:unknown=await r.json()
   if(!r.ok){if(saving&&[403,404,409,422].includes(r.status))setPending(null);throw new Error(object(d)&&typeof d.detail==='string'?d.detail:`Assignment request failed (${r.status}).`)}
   if(mode==='options'){if(!optionsValid(d))throw new Error('Unexpected worker options.');setOptions(d)}
   else{if(!stateValid(d)||d.worker_id!==worker)throw new Error('Unexpected assignment response.');setData(d);if(saving){setPending(null);setNote('')}}
  }catch(e){if(active.current===c)setError(c.signal.aborted?'Request timed out. Reload to check saved state or retry the same assignment.':e instanceof Error?e.message:'Assignment request failed.')}
  finally{window.clearTimeout(timer);if(active.current===c){active.current=null;setBusy(false)}}
 }
 const selected=data?.machines.find(m=>m.machine_id===machine)
 return <section className="card worker-machines"><p className="eyebrow">{owner?'OWNER WORKSPACE / STAFFING':'WORKER WORKSPACE / MACHINES'}</p><h2>{owner?'Assign machines to workers':'My assigned machines'}</h2>
  <p className="hint">Inactive machines remain in assignment history but cannot receive new assignments or new report links. Refresh workers and machines after changing the directory.</p>
  <p>{owner?'Choose the machines each worker reports on. Several workers can share a machine; technician repair assignments are managed separately.':'Your owner assigns these machines. When reviewing a new report, select the matching assigned machine or leave it unlinked for owner review.'}</p>
  {owner&&<><button className="secondary" disabled={locked} onClick={()=>run('options')}>{options?'Refresh workers and machines':'Load workers and machines'}</button>
   {options&&<label>Worker<select disabled={locked} value={worker} onChange={e=>{setWorker(e.target.value);setData(null);setMachine('');setNote('')}}><option value="">Choose a worker</option>{options.workers.map(w=><option key={w.worker_id} value={w.worker_id}>{w.name} · {w.username}{w.enabled?'':' · Disabled'}</option>)}</select></label>}
   {options?.workers_truncated&&<p className="hint">Showing the first 200 worker accounts.</p>}
  </>}
  <button className="secondary" disabled={busy||!worker} onClick={()=>run('load')}>{data?'Refresh assignments':'Load assigned machines'}</button>
  {error&&<p className="error" role="alert">{error}</p>}
  {pending&&<><p className="hint">Submitted values are locked until saving is confirmed.</p><button disabled={busy} onClick={()=>run(JSON.parse(pending).active?'assign':'remove')}>Retry same assignment</button></>}
  {data&&<><h3>{data.worker_name}{data.worker_enabled?'':' · Account disabled'}</h3>
   {data.machines.some(m=>m.active)?<ul>{data.machines.filter(m=>m.active).map(m=><li key={m.machine_id}><strong>{m.name} · {m.code}{m.machine_active?'':' · Machine inactive'}</strong><p>{m.department} · Assigned by {m.assigned_by}</p><p>{m.note}</p></li>)}</ul>:<p>No machines assigned yet. Reports can be left unlinked for owner review.</p>}
   {owner&&options&&<fieldset disabled={locked}>
    <label>Machine<select value={machine} onChange={e=>setMachine(e.target.value)}><option value="">Choose a machine</option>{options.machines.map(m=><option key={m.machine_id} value={m.machine_id}>{m.name} · {m.code}{m.machine_active?'':' · Inactive'}</option>)}</select></label>
    <label>Assignment or removal note<textarea maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label>
    <button disabled={!machine||!!selected?.active||!data.worker_enabled||!options.machines.find(m=>m.machine_id===machine)?.machine_active} onClick={()=>run('assign')}>Assign machine</button>
    <button className="secondary" disabled={!selected?.active} onClick={()=>run('remove')}>Remove assignment</button>
   </fieldset>}
   <details><summary>Assignment history · Latest 20</summary><ul>{data.history.map(e=><li key={e.event_id}><strong>{e.active?'Assigned':'Removed'} · {e.machine_name}</strong><p>{e.note}</p><p className="hint">{e.actor} · {new Date(e.created_at).toLocaleString()}</p></li>)}</ul></details>
  </>}
 </section>
}

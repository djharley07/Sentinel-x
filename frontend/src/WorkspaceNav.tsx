import { useState } from 'react'
import { SentinelMark } from './BrandExperience'
import { useAccount } from './Auth'
import './WorkspaceNav.css'
export type WorkspaceView = 'worker' | 'overview' | 'queue' | 'history' | 'accounts' | 'staffing' | 'analytics' | 'ask' | 'machines' | 'references' | 'redline' | 'work-board' | 'checklist' | 'edit-checklists' | 'submitted-checklists'
const views: {id:WorkspaceView;label:string;description:string}[] = [
 {id:'ask',label:'Ask SENTINEL',description:'Learn features and demo machine concepts'},
 {id:'worker',label:'Worker reporting',description:'Upload and verify a voice report'},
 {id:'checklist',label:'Checklist',description:'Record pre-use observations'},
 {id:'edit-checklists',label:'Edit Checklists',description:'Publish machine-specific checks'},
 {id:'submitted-checklists',label:'Submitted Checklists',description:'Review pre-use observations'},
 {id:'work-board',label:'Owner Work Board',description:'Find new, live and completed work'},
 {id:'redline',label:'REDLINE inbox',description:'Review and manage manual escalations'},
 {id:'overview',label:'Factory overview',description:'Reports, machines and active escalations'},
 {id:'analytics',label:'Maintenance analytics',description:'Reported patterns and work outcomes'},
 {id:'queue',label:'Technician queue',description:'Assigned work and repair logs'},
 {id:'history',label:'Report history',description:'Reviewed facts, evidence and memory'},
 {id:'references',label:'Reference documents',description:'Review and link machine reference text'},
 {id:'machines',label:'Machines',description:'Manage equipment details and service dates'},
 {id:'staffing',label:'Worker machines',description:'Assign factory machines to workers'},
 {id:'accounts',label:'Accounts',description:'Manage worker and technician access'},
]
export default function WorkspaceNav({view,onChange,workerBusy}:{view:WorkspaceView;onChange:(view:WorkspaceView)=>void;workerBusy:boolean}) {
 const account=useAccount()
 const permitted=views.filter(v=>v.id==='checklist' ? account.role==='worker' : account.role==='owner'||v.id==='ask'||(account.role==='technician'?v.id==='queue':v.id==='worker'||v.id==='history'))
 const [expanded,setExpanded]=useState(false)
 const groups:{label:string;ids:WorkspaceView[]}[]=[
  {label:'WORKSPACE',ids:['overview','work-board','queue','worker','checklist','ask']},
  {label:'REVIEW & INSIGHTS',ids:['redline','submitted-checklists','history','analytics']},
  {label:'MANAGEMENT',ids:['machines','staffing','edit-checklists','references','accounts']}
 ]
 return <nav className={`workspace-nav ${expanded?'nav-expanded':''}`} aria-label="Workspace views">
  <div className="workspace-nav-brand"><SentinelMark /><span>SENTINEL <b>X</b></span></div>
  <button className="nav-toggle secondary" type="button" aria-expanded={expanded} aria-controls="workspace-menu" onClick={()=>setExpanded(!expanded)}><NavIcon name="menu"/><strong>{views.find(v=>v.id===view)?.label??'Workspace'}</strong><span>{expanded?'Close':'Menu'}</span></button>
  <div id="workspace-menu" className="workspace-menu">{groups.map(group=>{
   const items=group.ids.map(id=>permitted.find(v=>v.id===id)).filter((v):v is typeof views[number]=>!!v)
   return items.length>0&&<div className="nav-group" key={group.label}><div className="nav-group-title">{group.label}</div>{items.map(v=><button type="button" key={v.id} aria-pressed={view===v.id} className={view===v.id?'workspace-nav-active':'secondary'} onClick={()=>{onChange(v.id);setExpanded(false)}}><NavIcon name={v.id}/><strong>{v.label}{v.id==='worker'&&workerBusy?' · Working…':''}</strong></button>)}</div>
  })}</div>
  <p className="hint nav-footnote"><span className="nav-account-dot" aria-hidden="true"/>{account.role.charAt(0).toUpperCase()+account.role.slice(1)} workspace<br/>Forms stay open when you switch views.</p>
 </nav>
}
function NavIcon({name}:{name:string}){
 const paths:Record<string,string>={
  overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  'work-board':'M4 5h16v15H4z M4 10h16 M9 10v10 M15 10v10',
  queue:'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  worker:'M12 3v12 M8 11l4 4 4-4 M5 16v5h14v-5',
  checklist:'M9 5h11 M9 12h11 M9 19h11 M3 5l1 1 2-3 M3 12l1 1 2-3 M3 19l1 1 2-3',
  ask:'M4 4h16v12H9l-5 4z M8 9h8 M8 12h5',
  redline:'M12 3 2 21h20z M12 9v5 M12 17h.01',
  'submitted-checklists':'M6 3h12v18H6z M9 8h6 M9 12h6 M9 16h4',
  history:'M3 10a9 9 0 1 1 2 8 M3 4v6h6 M12 7v5l3 2',
  analytics:'M4 20V10 M10 20V4 M16 20v-8 M22 20H2',
  machines:'M4 8h16v12H4z M8 8V4h8v4 M8 12h8 M8 16h3',
  staffing:'M7 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M1 21v-3a6 6 0 0 1 12 0v3 M17 8h6 M20 5v6 M16 16h7',
  'edit-checklists':'M14 4H4v17h16V11 M10 14l1-4 8-8 3 3-8 8z',
  references:'M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3z M12 6v16',
  accounts:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M4 22v-2a8 8 0 0 1 16 0v2',
  menu:'M3 6h18 M3 12h18 M3 18h18'
 }
 return <svg className="nav-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]??paths.overview}/></svg>
}

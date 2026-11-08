import { useEffect, useId, useState } from 'react'
export function SentinelMark({className=''}:{className?:string}) {
 const id=useId().replace(/:/g,'')
 return <svg className={`sentinel-mark ${className}`} viewBox="0 0 80 88" fill="none" aria-hidden="true"><defs><linearGradient id={id} x1="8" y1="0" x2="70" y2="88" gradientUnits="userSpaceOnUse"><stop stopColor="#c2edff"/><stop offset=".48" stopColor="#56c9e6"/><stop offset="1" stopColor="#36d5b4"/></linearGradient></defs><path d="M40 5 71 17 66 52Q62 70 40 82 18 70 14 52L9 17Z" fill="#102738" stroke={`url(#${id})`} strokeWidth="3"/><path d="m21 25 38 39M59 25 21 64" stroke="#07121f" strokeWidth="13"/><path d="m21 25 38 39M59 25 21 64" stroke={`url(#${id})`} strokeWidth="7" strokeLinecap="square"/><path d="m40 13 10 14H30Z" fill="#9ad8ee" opacity=".7"/></svg>
}
export function BrandHeader(){return <><div className="sentinel-wordmark"><SentinelMark/><div><strong>SENTINEL <span>X</span></strong><small>MAINTENANCE · CONNECTED</small></div></div><span className="badge"><i aria-hidden="true"/>Local workspace</span></>}
export default function BrandIntro(){
 const [visible,setVisible]=useState(()=>{try{return !window.matchMedia('(prefers-reduced-motion: reduce)').matches}catch{return false}})
 useEffect(()=>{if(!visible)return;const timer=window.setTimeout(()=>setVisible(false),2800);return()=>window.clearTimeout(timer)},[visible])
 if(!visible)return null
 return <div className="brand-intro" aria-label="Welcome to SENTINEL X"><div className="brand-intro-center"><div className="brand-intro-orbit"><SentinelMark/></div><div className="brand-intro-title">SENTINEL <span>X</span></div><div className="brand-credit"><p>Created By- Ritam Nandi</p><small>Connecting people. Simplifying maintenance.</small></div><div className="brand-intro-line"/></div><button type="button" onClick={()=>setVisible(false)}>Skip intro →</button></div>
}

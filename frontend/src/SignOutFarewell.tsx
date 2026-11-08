import { useEffect, useRef } from 'react'
import { SentinelMark } from './BrandExperience'
import './SignOutFarewell.css'
export default function SignOutFarewell({onDone}:{onDone:()=>void}){
 const done=useRef(onDone),button=useRef<HTMLButtonElement>(null)
 done.current=onDone
 useEffect(()=>{button.current?.focus();const timer=window.setTimeout(()=>done.current(),2400);return()=>window.clearTimeout(timer)},[])
 return <main className="signout-farewell"><div className="farewell-content"><div className="farewell-logo"><SentinelMark/><span className="farewell-check" aria-hidden="true">✓</span></div><p className="eyebrow">SENTINEL X</p><h1>Thank you.</h1><p className="farewell-message" role="status">You’re signed out.<br/>See you next time.</p><div className="brand-credit"><p>Created By- Ritam Nandi</p><small>Connecting people. Simplifying maintenance.</small></div><button ref={button} type="button" onClick={()=>done.current()}>Back to sign in →</button><div className="farewell-progress" aria-hidden="true"/></div></main>
}

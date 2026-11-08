import { useEffect, useRef, useState } from 'react'
import AskSentinel from './AskSentinel'
import './FloatingChat.css'

type Props = { visible: boolean; onReport: () => void }

export default function FloatingChat({ visible, onReport }: Props) {
  const [open, setOpen] = useState(false)
  const closeButton = useRef<HTMLButtonElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open && visible) closeButton.current?.focus()
  }, [open, visible])

  if (!visible) return null

  return <div className="floating-chat" onKeyDown={(event) => {
    if (event.key === 'Escape' && open) {
      setOpen(false)
      launcher.current?.focus()
    }
  }}>
    <aside className="floating-chat-panel" hidden={!open} aria-label="Quick Ask SENTINEL">
      <div className="floating-chat-bar">
        <strong>Quick chat</strong>
        <span>Separate conversation from the Ask SENTINEL tab</span>
        <button type="button" ref={closeButton} className="secondary" onClick={() => {
          setOpen(false)
          launcher.current?.focus()
        }} aria-label="Close quick chat">×</button>
      </div>
      <AskSentinel active={open} onReport={() => { setOpen(false); onReport() }} />
    </aside>
    <button type="button" className="floating-chat-launcher" ref={launcher}
      aria-label={open ? 'Close Ask SENTINEL quick chat' : 'Open Ask SENTINEL quick chat'}
      aria-expanded={open} onClick={() => setOpen(!open)}>
      <span aria-hidden="true">{open ? '×' : '✦'}</span>
    </button>
  </div>
}

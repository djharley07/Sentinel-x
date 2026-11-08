import { useId, useState, type InputHTMLAttributes } from 'react'
import './PasswordField.css'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> & { label: string }

export default function PasswordField({ label, disabled, ...props }: Props) {
  const id = useId()
  const [visible, setVisible] = useState(false)
  return <div className="password-field">
    <label htmlFor={id}>{label}</label>
    <div className="password-control">
      <input {...props} id={id} type={visible ? 'text' : 'password'} disabled={disabled} />
      <button type="button" className="secondary password-toggle" disabled={disabled}
        aria-controls={id} aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
        onClick={() => setVisible(current => !current)}>{visible ? 'Hide' : 'Show'}</button>
    </div>
  </div>
}

import { useEffect, useRef, useState } from 'react'
import { apiFetch } from './api'

type Machine = { machine_id: string; name: string; code: string; active: boolean; machine_active?: boolean }
type Template = { version: number; items: string[]; default_items: string[] }
const answerLabels = {
  no_concern: 'No concern noted',
  concern: 'Concern found',
  unsure: 'Unsure / needs review',
}
type Answer = keyof typeof answerLabels
type Saved = {
  id: string; machine_name: string; machine_code: string; worker_name: string
  version: number; items: string[]; answers: Answer[]; note: string
  submitted_at: string; needs_review: boolean; report_id: string | null
}

class RequestError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}
async function checklistRequest<T>(path: string, signal: AbortSignal, body?: string): Promise<T> {
  const response = await apiFetch(path, body === undefined ? { signal } : {
    signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  })
  const data = await response.json()
  if (!response.ok) {
    throw new RequestError(typeof data.detail === 'string' ? data.detail : `Request failed (${response.status}).`, response.status)
  }
  return data
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Request failed. Try again.'

export default function Checklists({ active, owner = false, onReport }: {
  active: boolean; owner?: boolean; onReport?: (text: string, submissionId: string | null) => void
}) {
  const [machines, setMachines] = useState<Machine[]>([])
  const [machineId, setMachineId] = useState('')
  const [template, setTemplate] = useState<Template | null>(null)
  const [items, setItems] = useState<string[]>([])
  const [answers, setAnswers] = useState<(Answer | '')[]>([])
  const [note, setNote] = useState('')
  const [submissionId, setSubmissionId] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const mutation = useRef(false)
  const machine = machines.find(row => row.machine_id === machineId)

  useEffect(() => {
    if (!active) return
    const request = new AbortController()
    const timeout = window.setTimeout(() => request.abort('timeout'), 20000)
    checklistRequest<{ machines: Machine[] }>(
      owner ? '/api/machine-references/machines' : '/api/worker-machines', request.signal,
    ).then(data => {
      if (request.signal.aborted) return
      const available = data.machines.filter(row => row.active && (owner || row.machine_active))
      setMachines(available)
      setMachineId(current => available.some(row => row.machine_id === current) ? current : '')
    }).catch(error => {
      if (!request.signal.aborted || request.signal.reason === 'timeout') {
        setMachines([])
        setError(message(error))
      }
    }).finally(() => window.clearTimeout(timeout))
    return () => { window.clearTimeout(timeout); request.abort() }
  }, [active, owner, refresh])

  useEffect(() => {
    if (!machineId) return
    const request = new AbortController()
    const timeout = window.setTimeout(() => request.abort('timeout'), 20000)
    checklistRequest<Template>(`/api/checklists/template/${machineId}`, request.signal).then(data => {
      if (request.signal.aborted) return
      setTemplate(data)
      setItems(data.items)
      setAnswers(data.items.map(() => ''))
    }).catch(error => {
      if (!request.signal.aborted || request.signal.reason === 'timeout') setError(message(error))
    }).finally(() => window.clearTimeout(timeout))
    return () => { window.clearTimeout(timeout); request.abort() }
  }, [machineId, refresh])

  function resetDraft() {
    setTemplate(null)
    setSubmissionId(null)
    setNote('')
    setError('')
    setStatus('')
  }

  async function save() {
    if (!machine || !template || mutation.current) return
    const body = pending ?? JSON.stringify(owner ? {
      expected_version: template.version, items: items.map(item => item.trim()),
    } : { request_id: crypto.randomUUID(), version: template.version, answers, note })
    mutation.current = true
    setBusy(true)
    setPending(body)
    setError('')
    try {
      if (owner) {
        const saved = await checklistRequest<Omit<Template, 'default_items'>>(
          `/api/checklists/template/${machineId}`, AbortSignal.timeout(30000), body,
        )
        setTemplate({ ...template, ...saved })
        setItems(saved.items)
        setStatus(`Published checklist version ${saved.version}.`)
      } else {
        const saved = await checklistRequest<{ id: string }>(`/api/checklists/submit/${machineId}`, AbortSignal.timeout(30000), body)
        setSubmissionId(saved.id)
        setStatus('Checklist submitted. The owner can view your answers.')
      }
      setPending(null)
    } catch (caught) {
      if (caught instanceof RequestError && caught.status >= 400 && caught.status < 500) setPending(null)
      setError(message(caught))
    } finally {
      mutation.current = false
      setBusy(false)
    }
  }

  const flagged = template?.items.flatMap((item, index) => {
    const answer = answers[index]
    return answer === 'concern' || answer === 'unsure' ? [`${item} — ${answerLabels[answer]}`] : []
  }) ?? []
  const locked = busy || pending !== null || (!owner && Boolean(status))
  const complete = owner ? items.every(item => item.trim()) : answers.length > 0 && answers.every(Boolean)

  return <section className="card">
    <p className="eyebrow">{owner ? 'OWNER' : 'WORKER'} WORKSPACE / PRE-USE</p>
    <h2>{owner ? 'Edit Checklists' : 'Checklist'}</h2>
    <p>{owner ? 'Publish the approved pre-use checks for each machine. The starter prompts are for the demo.' :
      'Record your observations before use. Follow the site’s approved procedures. A submission records observations and does not grant clearance.'}</p>
    <label>Machine <select value={machineId} disabled={busy || pending !== null} onChange={event => {
      resetDraft()
      setMachineId(event.target.value)
    }}>
      <option value="">Choose a machine</option>
      {machines.map(row => <option key={row.machine_id} value={row.machine_id}>{row.name} · {row.code}</option>)}
    </select></label>
    <button type="button" className="secondary" disabled={busy || pending !== null} onClick={() => {
      resetDraft()
      setRefresh(value => value + 1)
    }}>Reload machines and checklist</button>
    {error && <p className="error" role="alert">{error}</p>}
    {status && <p role="status">{status}</p>}
    {pending && !busy && <p className="hint">Retry to check or finish the same save.</p>}
    {machine && template && <>
      <p className="hint">{template.version === 0 ? 'Demo starter checklist' : `Published version ${template.version}`}</p>
      {owner ? <>
        {items.map((item, index) => <div key={index}>
          <label>Check {index + 1}
            <textarea rows={2} maxLength={250} disabled={locked} value={item} onChange={event => {
              const text = event.target.value
              setItems(previous => previous.map((value, i) => i === index ? text : value))
            }} />
          </label>
          <button type="button" className="secondary" disabled={locked || items.length === 1}
            onClick={() => setItems(previous => previous.filter((_, i) => i !== index))}>Remove check {index + 1}</button>
        </div>)}
        <button type="button" className="secondary" disabled={locked || items.length >= 20}
          onClick={() => setItems(previous => [...previous, ''])}>Add check</button>
        <button type="button" className="secondary" disabled={locked}
          onClick={() => setItems([...template.default_items])}>Use demo starter items</button>
      </> : <>
        {template.items.map((item, index) => <p key={index}><label>{item} <select
          value={answers[index] ?? ''} disabled={locked} onChange={event => {
            const answer = event.target.value as Answer | ''
            setAnswers(previous => previous.map((value, i) => i === index ? answer : value))
          }}>
          <option value="">Not answered</option>
          {Object.entries(answerLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label></p>)}
        <label>Observation note (optional)<textarea rows={3} maxLength={500} disabled={locked}
          value={note} onChange={event => setNote(event.target.value)} /></label>
      </>}
      <button type="button" disabled={busy || (!pending && (!complete || (!owner && Boolean(status))))}
        onClick={save}>{pending && !busy ? 'Retry same save' : owner ? 'Publish checklist' : 'Submit checklist'}</button>
      {!owner && flagged.length > 0 && <button type="button" className="secondary" disabled={busy}
        onClick={() => onReport?.(`Pre-use report for ${machine.name} (${machine.code}). ${flagged.join(' ')} ${note.trim()}`, submissionId)}>Prepare voice report</button>}
      {!owner && status && <button type="button" className="secondary" onClick={() => {
        resetDraft()
        setRefresh(value => value + 1)
      }}>Start another checklist</button>}
    </>}
  </section>
}

export function SubmittedChecklists({ active, onOpen }: { active: boolean; onOpen: (id: string) => void }) {
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [offset, setOffset] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [data, setData] = useState<{ submissions: Saved[]; has_more: boolean } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!active) return
    const request = new AbortController()
    const timeout = window.setTimeout(() => request.abort('timeout'), 20000)
    setData(null)
    setError('')
    checklistRequest<{ submissions: Saved[]; has_more: boolean }>(
      `/api/checklists/submissions?needs_review=${flaggedOnly}&offset=${offset}`, request.signal,
    ).then(result => { if (!request.signal.aborted) setData(result) })
      .catch(error => {
        if (!request.signal.aborted || request.signal.reason === 'timeout') setError(message(error))
      }).finally(() => window.clearTimeout(timeout))
    return () => { window.clearTimeout(timeout); request.abort() }
  }, [active, flaggedOnly, offset, refresh])

  return <section className="card">
    <p className="eyebrow">OWNER WORKSPACE / PRE-USE</p>
    <h2>Submitted Checklists</h2>
    <label><input type="checkbox" checked={flaggedOnly} onChange={event => {
      setFlaggedOnly(event.target.checked)
      setOffset(0)
    }} /> Concerns or uncertainty only</label>
    <button type="button" className="secondary" onClick={() => setRefresh(value => value + 1)}>Refresh submissions</button>
    {error && <p className="error" role="alert">{error}</p>}
    {!error && !data && <p role="status">Loading submissions…</p>}
    {data?.submissions.length === 0 && <p>No submissions match this view.</p>}
    {data?.submissions.map(row => <details key={row.id}>
      <summary>{row.machine_name} · {row.machine_code} · {row.worker_name} · {new Date(row.submitted_at).toLocaleString()} · {row.needs_review ? 'Needs review' : 'No concerns reported'}</summary>
      <p>{row.version ? `Checklist version ${row.version}` : 'Demo starter checklist'}</p>
      <ul>{row.items.map((item, index) => <li key={index}>{item} <strong>{answerLabels[row.answers[index]]}</strong></li>)}</ul>
      {row.note && <p>{row.note}</p>}
      {row.report_id && <button type="button" className="secondary" onClick={() => {
        if (row.report_id) onOpen(row.report_id)
      }}>Open linked report</button>}
    </details>)}
    <div className="redline-inbox-actions">
      <button type="button" className="secondary" disabled={offset === 0} onClick={() => setOffset(offset - 20)}>Previous</button>
      <button type="button" className="secondary" disabled={!data?.has_more} onClick={() => setOffset(offset + 20)}>Next</button>
    </div>
  </section>
}

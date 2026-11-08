import { apiFetch } from './api'
import { useEffect, useRef, useState } from 'react'
import FactReview from './FactReview'

type Facts = {
  equipment_label: string | null
  reported_issue: string | null
  temperature_value: number | null
  temperature_unit: string | null
  issue_started_at: string | null
}
type Extraction = {
  extraction_id: string
  attempt_id: string
  verified_transcript: string
  created_at: string
  model: string
  facts: Facts
  persistence_status: 'saved'
  requires_human_review: true
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const text = (v: unknown) => v === null || typeof v === 'string'
function valid(v: unknown, attemptId: string, transcript: string): v is Extraction {
  if (!object(v) || !object(v.facts)) return false
  const f = v.facts
  return v.attempt_id === attemptId && v.verified_transcript === transcript &&
    typeof v.extraction_id === 'string' && typeof v.model === 'string' &&
    typeof v.created_at === 'string' && Number.isFinite(Date.parse(v.created_at)) &&
    v.persistence_status === 'saved' && v.requires_human_review === true &&
    text(f.equipment_label) && text(f.reported_issue) && text(f.issue_started_at) && text(f.temperature_unit) &&
    (f.temperature_value === null || typeof f.temperature_value === 'number' && Number.isFinite(f.temperature_value))
}

export default function SavedExtraction({ attemptId, transcript }: { attemptId: string; transcript: string }) {
  const [result, setResult] = useState<Extraction | null>(null)
  const [busy, setBusy] = useState(false)
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState('')
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => { active.current?.abort(); active.current = null }, [])

  async function request(generate: boolean) {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    const timer = window.setTimeout(() => controller.abort(), generate ? 180000 : 30000)
    setBusy(true)
    setError('')
    try {
      const response = await apiFetch(`/api/attempts/${attemptId}/extraction`, {
        method: generate ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal,
      })
      const data: unknown = await response.json()
      if (!response.ok) throw new Error(object(data) && typeof data.detail === 'string' ? data.detail : `Extraction request failed (${response.status}).`)
      if (!object(data) || !(data.extraction === null && !generate || valid(data.extraction, attemptId, transcript))) {
        throw new Error('The server returned an unexpected extraction response.')
      }
      if (active.current !== controller || controller.signal.aborted) return
      setResult(data.extraction as Extraction | null)
      setChecked(true)
    } catch (caught) {
      if (active.current !== controller) return
      setChecked(false)
      setError(controller.signal.aborted ? 'The request timed out. Check saved results before generating again.' : caught instanceof Error ? caught.message : 'Could not load extraction.')
    } finally {
      window.clearTimeout(timer)
      if (active.current === controller) { active.current = null; setBusy(false) }
    }
  }

  return <section aria-label="Structured maintenance facts" style={{ borderTop: '1px solid #64748b', marginTop: 16, paddingTop: 12 }}>
    <h5>Structured maintenance facts</h5>
    <p className="hint">Original AI-extracted draft · Review status is shown below. This is not a diagnosis or safety assessment.</p>
    {!result && <button className="secondary" disabled={busy} onClick={() => request(checked)}>
      {busy ? 'Working…' : checked ? 'Extract and save facts' : 'Check saved facts'}
    </button>}
    {!result && checked && <p className="hint">No extraction saved yet. Extracting sends the verified text to OpenRouter.</p>}
    {busy && <p role="status">{checked ? 'Extracting and saving facts…' : 'Checking saved results…'}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {result && <>
      <dl>
        <dt>Equipment</dt><dd>{result.facts.equipment_label ?? 'Not reported'}</dd>
        <dt>Reported issue</dt><dd>{result.facts.reported_issue ?? 'Not reported'}</dd>
        <dt>Temperature</dt><dd>{result.facts.temperature_value === null ? 'Not reported' : `${result.facts.temperature_value} ${result.facts.temperature_unit ?? '(unit not reported)'}`}</dd>
        <dt>Issue started</dt><dd>{result.facts.issue_started_at ?? 'Not reported'}</dd>
      </dl>
      <p className="hint">Saved {new Date(result.created_at).toLocaleString()} · {result.model}</p>
      <p className="hint">The verified transcript above remains the source of record.</p>
      <FactReview key={result.extraction_id} extractionId={result.extraction_id} initial={result.facts} />
    </>}
  </section>
}

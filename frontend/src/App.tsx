import { useRef, useState } from 'react'
import './index.css'

type Decision = 'accepted' | 'corrected' | 'rerecord_requested'
type ReviewRequest = { decision: Decision; corrected_transcript?: string }
type Transcription = {
  transcript: string
  model: string | null
  detected_language_code: string | null
  request_id: string | null
  verification_status: 'pending'
  persistence_status: 'saved'
  report_id: string
  attempt_id: string
}
type Review = {
  review_id: string
  report_id: string
  attempt_id: string
  decision: Decision
  original_transcript: string
  verified_transcript: string | null
  review_source: 'local_demo'
  persistence_status: 'saved'
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const optionalText = (value: unknown) => typeof value === 'string' || value === null
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

function isTranscription(value: unknown): value is Transcription {
  return record(value) && typeof value.transcript === 'string' &&
    value.transcript.trim().length > 0 && uuid(value.report_id) && uuid(value.attempt_id) &&
    value.verification_status === 'pending' && value.persistence_status === 'saved' &&
    optionalText(value.model) && optionalText(value.detected_language_code) && optionalText(value.request_id)
}

function isReview(value: unknown, attempt: Transcription, sent: ReviewRequest): value is Review {
  const expected = sent.decision === 'accepted' ? attempt.transcript :
    sent.decision === 'corrected' ? sent.corrected_transcript : null
  return record(value) && uuid(value.review_id) && value.report_id === attempt.report_id &&
    value.attempt_id === attempt.attempt_id && value.decision === sent.decision &&
    value.original_transcript === attempt.transcript && value.verified_transcript === expected &&
    value.review_source === 'local_demo' && value.persistence_status === 'saved'
}

function detail(value: unknown, status: number) {
  return record(value) && typeof value.detail === 'string'
    ? value.detail : `Request failed (${status}). Check the backend terminal.`
}

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<Transcription | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [busy, setBusy] = useState(false)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [error, setError] = useState('')
  const [reviewError, setReviewError] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<ReviewRequest | null>(null)
  const [conflict, setConflict] = useState(false)
  const [uploadUncertain, setUploadUncertain] = useState(false)
  const [inputKey, setInputKey] = useState(0)
  const inFlight = useRef(false)

  async function transcribe() {
    if (!file || result || uploadUncertain || inFlight.current) return
    setError('')
    if (file.size === 0 || file.size > 10 * 1024 * 1024) {
      setError('Choose a non-empty audio file no larger than 10 MiB.')
      return
    }
    inFlight.current = true
    setBusy(true)
    const form = new FormData()
    form.append('audio', file)
    try {
      const response = await fetch('/api/speech/transcribe', {
        method: 'POST', body: form, signal: AbortSignal.timeout(180000),
      })
      const data: unknown = await response.json()
      if (!response.ok) {
        // Validation errors happen before any report can be saved.
        if (![400, 413, 415, 422].includes(response.status)) setUploadUncertain(true)
        setError(detail(data, response.status))
        return
      }
      if (!isTranscription(data)) throw new Error('Unexpected response')
      setResult(data)
      setDraft(data.transcript)
    } catch {
      setUploadUncertain(true)
      setError('Could not confirm the result. The report may still have been saved. Check the backend and database before uploading again.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  async function saveReview(sent: ReviewRequest) {
    if (!result || review || conflict || inFlight.current) return
    // Freeze the submitted payload so an uncertain result can be retried safely.
    const payload = pending ?? sent
    if (payload.decision === 'corrected' && !payload.corrected_transcript?.trim()) {
      setReviewError('Enter the corrected transcript before saving.')
      return
    }
    inFlight.current = true
    setPending(payload)
    setReviewBusy(true)
    setReviewError('')
    try {
      const response = await fetch(`/api/attempts/${result.attempt_id}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(60000),
      })
      const data: unknown = await response.json()
      if (!response.ok) {
        if (response.status === 409 || response.status === 404) {
          setConflict(true)
          setReviewError(`${detail(data, response.status)} Check the saved review before continuing.`)
        } else if (response.status === 422) {
          setPending(null)
          setReviewError('Review validation failed. Check the decision and correction text.')
        } else {
          setReviewError('Could not confirm saving. Use Retry same review; do not submit a different decision.')
        }
        return
      }
      if (!isReview(data, result, payload)) throw new Error('Unexpected review response')
      setReview(data)
      setPending(null)
      setEditing(false)
    } catch {
      setReviewError('Could not confirm saving. Use Retry same review; do not submit a different decision.')
    } finally {
      inFlight.current = false
      setReviewBusy(false)
    }
  }

  function startNewReport() {
    if (inFlight.current || !review || review.decision === 'rerecord_requested') return
    setFile(null)
    setResult(null)
    setReview(null)
    setDraft('')
    setEditing(false)
    setPending(null)
    setConflict(false)
    setError('')
    setReviewError('')
    setInputKey((key) => key + 1)
  }

  const locked = reviewBusy || pending !== null || conflict
  return (
    <main className="workspace">
      <header className="topbar">
        <strong>SENTINEL <span>X</span></strong>
        <span className="badge">LOCAL DEVELOPMENT</span>
      </header>
      <section className="intro">
        <p className="eyebrow">WORKER WORKSPACE / VOICE REPORT</p>
        <h1>Every report starts<br />with a clear voice.</h1>
        <p>Upload a short recording, then review what the system heard.</p>
      </section>
      <div className="columns">
        <section className="card" aria-labelledby="upload-heading">
          <p className="eyebrow">01 / RECORDING</p>
          <h2 id="upload-heading">Upload your report</h2>
          <p>Use a recording under 30 seconds, up to 10 MiB.</p>
          <label className="upload" htmlFor="audio-file">
            <span>Choose an audio recording</span>
            <input key={inputKey} id="audio-file" type="file"
              accept=".wav,.mp3,.m4a,.ogg,.flac,.aac"
              disabled={busy || result !== null || uploadUncertain}
              onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError('') }} />
          </label>
          <p className="hint">WAV, MP3, M4A, OGG, FLAC or AAC</p>
          <button disabled={!file || busy || result !== null || uploadUncertain} onClick={transcribe}>
            {busy ? 'Transcribing and saving…' : 'Transcribe recording'}
          </button>
          <p className="hint">Clicking transcribe sends this recording to Gnani AI.</p>
          {busy && <p role="status">Waiting for the transcription and saved report…</p>}
          {error && <p className="error" role="alert">{error}</p>}
          {result && <p className="hint">Recording submitted. Review its transcript on the right.</p>}
          {review && review.decision !== 'rerecord_requested' &&
            <button className="secondary" onClick={startNewReport}>Start a new report</button>}
        </section>
        <section className="card" aria-labelledby="transcript-heading" aria-busy={busy || reviewBusy}>
          <p className="eyebrow">02 / TRANSCRIPT</p>
          <h2 id="transcript-heading">What the system heard</h2>
          {result ? <>
            <span className={`review ${review ? 'saved' : ''}`}>
              {review ? (review.decision === 'rerecord_requested' ? 'Re-record requested' : 'Review saved') : 'Review required'}
            </span>
            <p className="transcript">{result.transcript}</p>
            <dl>
              <dt>Model</dt><dd>{result.model ?? 'Not returned'}</dd>
              <dt>Detected language</dt><dd>{result.detected_language_code ?? 'Not returned'}</dd>
              <dt>Report ID</dt><dd>{result.report_id}</dd>
            </dl>
            {review ? <div className="review-result" role="status">
              {review.decision === 'rerecord_requested' ? <>
                <h3>New recording requested</h3>
                <p>This transcript has not been verified. Its original text and recording are preserved.</p>
                <p className="hint">Uploading a replacement for this report is coming next.</p>
              </> : <>
                <h3>{review.decision === 'corrected' ? 'Corrected transcript' : 'Accepted transcript'}</h3>
                <p className="verified-text">{review.verified_transcript}</p>
                <p className="hint">Your review is saved. The original transcript above is unchanged.</p>
              </>}
            </div> : <>
              <p className="hint">Check the machine number, symptoms, temperature and units before saving. A saved review cannot be changed in this demo.</p>
              {editing ? <div className="editor">
                <label htmlFor="correction">Corrected transcript</label>
                <textarea id="correction" rows={6} maxLength={20000} value={draft}
                  disabled={locked} onChange={(event) => setDraft(event.target.value)} />
                <button disabled={locked || !draft.trim()} onClick={() => saveReview({ decision: 'corrected', corrected_transcript: draft.trim() })}>Save corrected transcript</button>
                <button className="secondary" disabled={locked} onClick={() => { setEditing(false); setReviewError('') }}>Cancel editing</button>
              </div> : <div className="review-actions">
                <button disabled={locked} onClick={() => saveReview({ decision: 'accepted' })}>Accept transcript</button>
                <button className="secondary" disabled={locked} onClick={() => { setEditing(true); setReviewError('') }}>Edit transcript</button>
                <button className="secondary" disabled={locked} onClick={() => saveReview({ decision: 'rerecord_requested' })}>Request re-recording</button>
              </div>}
              {reviewBusy && <p role="status">Saving your review…</p>}
              {reviewError && <p className="error" role="alert">{reviewError}</p>}
              {pending && !reviewBusy && !conflict && <button onClick={() => saveReview(pending)}>Retry same review</button>}
              {(pending || conflict) && <p className="hint">Keep this page open until the saved review is confirmed.</p>}
            </>}
          </> : <p className="empty">Your transcription will appear here after processing.</p>}
        </section>
      </div>
      <footer>Local demo · Reports and reviews are saved to the database · Recordings stay on this laptop · History view coming next</footer>
    </main>
  )
}

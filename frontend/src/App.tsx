import { useState } from 'react'
import './index.css'

type Transcription = {
  transcript: string
  model: string | null
  detected_language_code: string | null
  request_id: string | null
  verification_status: 'pending'
}

function isTranscription(value: unknown): value is Transcription {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  const optionalText = (field: unknown) =>
    typeof field === 'string' || field === null

  return (
    typeof item.transcript === 'string' &&
    item.transcript.trim().length > 0 &&
    item.verification_status === 'pending' &&
    optionalText(item.model) &&
    optionalText(item.detected_language_code) &&
    optionalText(item.request_id)
  )
}

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<Transcription | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function transcribe() {
    if (!file || busy) return

    setError('')
    setResult(null)

    if (file.size === 0 || file.size > 10 * 1024 * 1024) {
      setError('Choose a non-empty audio file no larger than 10 MiB.')
      return
    }

    setBusy(true)
    const form = new FormData()
    form.append('audio', file)

    try {
      const response = await fetch('/api/speech/transcribe', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(90000),
      })

      const data: unknown = await response.json().catch(() => null)

      if (!response.ok) {
        const detail =
          typeof data === 'object' && data !== null && 'detail' in data
            ? data.detail
            : null

        throw new Error(
          typeof detail === 'string'
            ? detail
            : `Request failed (${response.status}). Check the backend terminal.`,
        )
      }

      if (!isTranscription(data)) {
        throw new Error('The server returned an unexpected response.')
      }

      setResult(data)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Transcription failed. Check that the backend is running.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <strong>SENTINEL <span>X</span></strong>
        <span className="badge">LOCAL DEVELOPMENT</span>
      </header>

      <section className="intro">
        <p className="eyebrow">WORKER WORKSPACE / VOICE REPORT</p>
        <h1>Every report starts<br />with a clear voice.</h1>
        <p>Upload a short recording of a machine problem to transcribe it.</p>
      </section>

      <div className="columns">
        <section className="card" aria-labelledby="upload-heading">
          <p className="eyebrow">01 / RECORDING</p>
          <h2 id="upload-heading">Upload your report</h2>
          <p>Use a recording under 30 seconds, up to 10 MiB.</p>

          <label className="upload" htmlFor="audio-file">
            <span>Choose an audio recording</span>
            <input
              id="audio-file"
              type="file"
              accept=".wav,.mp3,.m4a,.ogg,.flac,.aac"
              disabled={busy}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null)
                setResult(null)
                setError('')
              }}
            />
          </label>

          <p className="hint">WAV, MP3, M4A, OGG, FLAC or AAC</p>
          <button disabled={!file || busy} onClick={transcribe}>
            {busy ? 'Transcribing…' : 'Transcribe recording'}
          </button>

          <p className="hint">
            Clicking transcribe sends this recording to Gnani AI.
          </p>
          {busy && <p role="status">Waiting for the transcription…</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </section>

        <section
          className="card"
          aria-labelledby="transcript-heading"
          aria-busy={busy}
        >
          <p className="eyebrow">02 / TRANSCRIPT</p>
          <h2 id="transcript-heading">What the system heard</h2>

          <div aria-live="polite">
            {result ? (
              <>
                <span className="review">Review required</span>
                <p className="transcript">{result.transcript}</p>
                <dl>
                  <dt>Model</dt>
                  <dd>{result.model ?? 'Not returned'}</dd>
                  <dt>Detected language</dt>
                  <dd>{result.detected_language_code ?? 'Not returned'}</dd>
                </dl>
                <p className="hint">
                  This transcript is unverified. Confirmation controls are
                  the next development step.
                </p>
              </>
            ) : (
              <p className="empty">
                Your transcription will appear here after processing.
              </p>
            )}
          </div>
        </section>
      </div>

      <footer>
        Development preview · Reports are not saved yet ·
        Refreshing clears this screen
      </footer>
    </main>
  )
}
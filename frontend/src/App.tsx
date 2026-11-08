import { BrandHeader } from './BrandExperience'
import OwnerWorkBoard from './OwnerWorkBoard'
import { OwnerRedlineBanner, RedlineInbox } from './RedlineInbox'
import MachineReferences from './MachineReferences'
import MachineAdmin from './MachineAdmin'
import AskSentinel from './AskSentinel'
import FloatingChat from './FloatingChat'
import EquipmentCheck,{equipmentKey} from './EquipmentCheck'
import TranscriptCorrection from './TranscriptCorrection'
import ReportReadback from './ReportReadback'
import MaintenanceAnalytics from './MaintenanceAnalytics'
import Checklists, { SubmittedChecklists } from './Checklists'
import WorkerMachines from './WorkerMachines'
import AccountAdmin from './AccountAdmin'
import { useAccount } from './Auth'
import { apiFetch } from './api'
import MicrophoneRecorder, { AudioPreview } from './MicrophoneRecorder'
import WorkspaceNav, { type WorkspaceView } from './WorkspaceNav'
import WorkQueue from './WorkQueue'

import FactoryOverview from './FactoryOverview'

import ReportHistory, { isHistoryReport } from './ReportHistory'

import { useRef, useState } from 'react'
import './index.css'

type Decision = 'accepted' | 'corrected' | 'rerecord_requested'
type ReviewRequest = { decision: Decision; corrected_transcript?: string; equipment_check_acknowledged?: boolean }
type Transcription = {
  transcript: string
  model: string | null
  detected_language_code: string | null
  request_id: string | null
  verification_status: 'pending'
  persistence_status: 'saved'
  report_id: string
  attempt_id: string
  attempt_number: number
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
    typeof value.attempt_number === 'number' && Number.isSafeInteger(value.attempt_number) && value.attempt_number > 0 &&
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
  const account = useAccount()
  const [entryMode, setEntryMode] = useState<'voice' | 'typed'>('voice')
  const [typedText, setTypedText] = useState('')
  const typedSubmission = useRef<{ text: string; request_id: string; replaces_attempt_id?: string } | null>(null)
  const [typedUncertain, setTypedUncertain] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [recordingBusy, setRecordingBusy] = useState(false)
  const [speakingMode, setSpeakingMode] = useState('auto')
  const [result, setResult] = useState<Transcription | null>(null)
  const [equipmentApproval,setEquipmentApproval]=useState('')
  const [correctedLater,setCorrectedLater]=useState(false)
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
  const [resumeBusy, setResumeBusy] = useState(false)
  const [resumeError, setResumeError] = useState('')
  const [resumed, setResumed] = useState(false)
  // SENTINEL_WORKSPACE_NAV_V1
  const [checklistDraft, setChecklistDraft] = useState('')
  const [checklistSubmission, setChecklistSubmission] = useState<string | null>(null)
  const [reportLink, setReportLink] = useState<{ submissionId: string; reportId: string } | null>(null)
  const [linkStatus, setLinkStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [linkError, setLinkError] = useState('')
  const [view, setView] = useState<WorkspaceView>(account.role === 'technician' ? 'queue' : account.role === 'owner' ? 'overview' : 'worker')
  const [boardReport, setBoardReport] = useState<{ id: string } | null>(null)
  const [directReport,setDirectReport] = useState<{id:string}|null>(null)
  const [directReportOpen,setDirectReportOpen] = useState(false)
  const [historyVersion, setHistoryVersion] = useState(0)
  const inFlight = useRef(false)
  const resumeDisabled = recordingBusy || busy || reviewBusy || resumeBusy || uploadUncertain ||
    pending !== null || conflict || result !== null || file !== null || typedText.trim() !== '' || typedUncertain

  const replacing = result !== null && review?.decision === 'rerecord_requested'
  const uploadLocked = recordingBusy || busy || reviewBusy || resumeBusy || uploadUncertain || (result !== null && !replacing)

  async function resumeReview(reportId: string, attemptId: string) {
    if (resumeDisabled || inFlight.current) return
    inFlight.current = true
    setResumeBusy(true)
    setResumeError('')
    try {
      // Read again instead of trusting a potentially stale history card.
      const response = await apiFetch(`/api/reports/${reportId}`, {
        signal: AbortSignal.timeout(30000), cache: 'no-store',
      })
      const data: unknown = await response.json()
      if (!response.ok) throw new Error(detail(data, response.status))
      if (!isHistoryReport(data, reportId)) throw new Error('The server returned an unexpected report response.')
      const latest = data.attempts[data.attempts.length - 1]
      if (!latest || latest.attempt_id !== attemptId || latest.verification_status !== 'pending') {
        throw new Error('This attempt is no longer the latest pending review. Refresh reports to see its current status.')
      }
      const restored = {
        report_id: data.report_id, attempt_id: latest.attempt_id,
        attempt_number: latest.attempt_number, transcript: latest.original_transcript,
        model: latest.model, detected_language_code: latest.detected_language_code,
        request_id: latest.request_id, verification_status: 'pending', persistence_status: 'saved',
      }
      if (!isTranscription(restored)) throw new Error('The saved transcript could not be loaded for review.')
      setResult(restored)
      setDraft(restored.transcript)
      setCorrectedLater(false)
      setReview(null)
      setPending(null)
      setEditing(false)
      setConflict(false)
      setError('')
      setReviewError('')
      setResumed(true)
      setView('worker')
      requestAnimationFrame(() => {
      document.getElementById('transcript-heading')?.focus()
      document.getElementById('transcript-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    } catch (caught) {
      setResumeError(caught instanceof Error ? caught.message : 'Could not open the saved review. Try again.')
    } finally {
      inFlight.current = false
      setResumeBusy(false)
    }
  }

  async function transcribe() {
    if (uploadLocked || inFlight.current || (entryMode === 'voice' ? !file : !typedText.trim())) return
    setError('')
    if (entryMode === 'voice' && file && (file.size === 0 || file.size > 10 * 1024 * 1024)) {
      setError('Choose a non-empty audio file no larger than 10 MiB.')
      return
    }
    inFlight.current = true
    setBusy(true)
    const form = new FormData()
    if (file) form.append('audio', file)
    form.append('speaking_mode', speakingMode)
    if (replacing && result) form.append('replaces_attempt_id', result.attempt_id)
    if (entryMode === 'typed' && !typedSubmission.current) {
      typedSubmission.current = { text: typedText.trim(), request_id: crypto.randomUUID(),
        ...(replacing && result ? { replaces_attempt_id: result.attempt_id } : {}) }
    }
    try {
      const response = await apiFetch(entryMode === 'typed' ? '/api/speech/typed' : '/api/speech/transcribe', {
        method: 'POST',
        ...(entryMode === 'typed' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(typedSubmission.current) } : { body: form }),
        signal: AbortSignal.timeout(180000),
      })
      const data: unknown = await response.json()
      if (!response.ok) {
        // Validation errors happen before any report can be saved.
        if (![400, 413, 415, 422].includes(response.status)) {
          if (entryMode === 'typed') setTypedUncertain(true)
          else setUploadUncertain(true)
        }
        setError(detail(data, response.status))
        return
      }
      if (!isTranscription(data)) throw new Error('Unexpected response')
      if (replacing && result && (
        data.report_id !== result.report_id ||
        data.attempt_id === result.attempt_id ||
        data.attempt_number !== result.attempt_number + 1
      )) throw new Error('Unexpected replacement response')
      setTypedUncertain(false)
      typedSubmission.current = null
      setResult(data)
      if (!replacing && checklistSubmission) {
        setReportLink({ submissionId: checklistSubmission, reportId: data.report_id })
        setChecklistSubmission(null)
      }
      setResumed(false)
      setHistoryVersion((version) => version + 1)
      setDraft(data.transcript)
      setCorrectedLater(false)
      setReview(null)
      setPending(null)
      setEditing(false)
      setConflict(false)
      setReviewError('')
    } catch {
      if (entryMode === 'typed') setTypedUncertain(true)
      else setUploadUncertain(true)
      setError(entryMode === 'typed' ? 'Could not confirm saving. Retry this same typed submission.' : 'Could not confirm the result. The report may still have been saved. Check the backend and database before uploading again.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  async function saveReview(sent: ReviewRequest) {
    if (!result || review || conflict || inFlight.current) return
    // Freeze the submitted payload so an uncertain result can be retried safely.
    const payload = pending ?? {...sent,equipment_check_acknowledged:equipmentApproval==='ack:'+equipmentKey(result.attempt_id,(sent.decision==='corrected'?sent.corrected_transcript??'':result.transcript).trim())}
    if (payload.decision === 'corrected' && !payload.corrected_transcript?.trim()) {
      setReviewError('Enter the corrected transcript before saving.')
      return
    }
    inFlight.current = true
    setPending(payload)
    setReviewBusy(true)
    setReviewError('')
    try {
      const response = await apiFetch(`/api/attempts/${result.attempt_id}/review`, {
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
          setReviewError(detail(data,response.status))
        } else {
          setReviewError('Could not confirm saving. Use Retry same review; do not submit a different decision.')
        }
        return
      }
      if (!isReview(data, result, payload)) throw new Error('Unexpected review response')
      setReview(data)
      setHistoryVersion((version) => version + 1)
      if (data.decision === 'rerecord_requested') {
        // Require an explicit file selection for the next attempt.
        setFile(null)
        setInputKey((key) => key + 1)
        setError('')
      }
      setPending(null)
      setEditing(false)
    } catch {
      setReviewError('Could not confirm saving. Use Retry same review; do not submit a different decision.')
    } finally {
      inFlight.current = false
      setReviewBusy(false)
    }
  }

  async function linkChecklistReport() {
    if (!reportLink || reportLink.reportId !== result?.report_id || !review ||
        review.decision === 'rerecord_requested' || inFlight.current || linkStatus !== 'idle') return
    inFlight.current = true
    setLinkStatus('saving')
    setLinkError('')
    try {
      const response = await apiFetch(`/api/checklists/link/${reportLink.submissionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_id: reportLink.reportId }),
        signal: AbortSignal.timeout(20000),
      })
      const data: unknown = await response.json()
      if (!response.ok) throw new Error(detail(data, response.status))
      if (!record(data) || data.report_id !== reportLink.reportId) throw new Error('Could not confirm the link.')
      setLinkStatus('saved')
    } catch (caught) {
      setLinkError(caught instanceof Error ? caught.message : 'Could not confirm the link. Try again.')
      setLinkStatus('idle')
    } finally {
      inFlight.current = false
    }
  }

  function startNewReport() {
    if (inFlight.current || !review || review.decision === 'rerecord_requested') return
    if (reportLink && !checklistSubmission) setChecklistDraft('')
    setReportLink(null)
    setLinkStatus('idle')
    setLinkError('')
    setTypedText('')
    typedSubmission.current = null
    setTypedUncertain(false)
    setFile(null)
    setResumed(false)
    setResumeError('')
    setResult(null)
    setReview(null)
    setDraft('')
    setEditing(false)
    setPending(null)
    setConflict(false)
    setError('')
    setUploadUncertain(false)
    setReviewError('')
    setInputKey((key) => key + 1)
  }

  const locked = reviewBusy || pending !== null || conflict
  const checkText = (editing?draft:result?.transcript??'').trim()
  const equipmentReady = !!result && [equipmentKey(result.attempt_id,checkText),`ack:${equipmentKey(result.attempt_id,checkText)}`].includes(equipmentApproval)
  return (
    <main className="workspace">
      <header className="topbar">
        <BrandHeader />
      </header>
      {account.role === 'owner' && <OwnerRedlineBanner onOpen={()=>setView('redline')} />}
      <WorkspaceNav view={view} onChange={setView} workerBusy={recordingBusy || busy || reviewBusy || resumeBusy} />
      {account.role === 'worker' && <div className="workspace-view" hidden={view !== 'checklist'} aria-label="Worker checklist">
        <Checklists active={view === 'checklist'} onReport={(draft, submissionId) => {
          setChecklistDraft(draft)
          setChecklistSubmission(submissionId)
          setView('worker')
        }} />
      </div>}
      {account.role !== 'technician' && <><div className="workspace-view worker-reporting" hidden={view !== 'worker'} aria-label="Worker reporting">
      {account.role === 'worker' && <WorkerMachines />}
      <section className="intro">
        <p className="eyebrow">WORKER WORKSPACE / REPORTING</p>
        <h1>Report what you noticed.</h1>
        <p>Record or type your report, then review it before confirming.</p><ol className="report-steps" aria-label="Report progress"><li className={!result||replacing?'step-current':'step-complete'} aria-current={!result||replacing?'step':undefined}><span>1</span><div><strong>Capture</strong><small>Record or type the issue</small></div></li><li className={result&&!review?'step-current':review&&review.decision!=='rerecord_requested'?'step-complete':''} aria-current={result&&!review?'step':undefined}><span>2</span><div><strong>Review</strong><small>Check names and readings</small></div></li><li className={review&&review.decision!=='rerecord_requested'?'step-complete':''}><span>3</span><div><strong>Confirm</strong><small>{review&&review.decision!=='rerecord_requested'?'Transcript review saved':'Save your transcript review'}</small></div></li></ol>
      </section>
      {checklistDraft && <section className="card" aria-label="Checklist report draft">
        <h2>Checklist report draft</h2>
        <p>Use this draft when recording your report. Include the machine code and describe what you noticed in your own words.</p>
        <p>{checklistDraft}</p>
        {checklistSubmission && <p className="hint">After verifying the new report, you can link it to the submitted checklist.</p>}
        <button type="button" className="secondary" onClick={() => { setChecklistDraft(''); setChecklistSubmission(null) }}>Dismiss draft</button>
      </section>}
      <div className="columns">
        <section className="card report-input-card" aria-labelledby="upload-heading">
          <p className="eyebrow">01 / REPORT INPUT</p>
          <h2 id="upload-heading">{replacing ? 'Replace your recording' : 'Tell us what happened'}</h2>
          <label className="report-format">Report format
            <select value={entryMode} disabled={uploadLocked || typedUncertain} onChange={event => { setEntryMode(event.target.value as 'voice' | 'typed'); typedSubmission.current = null; setError('') }}>
              <option value="voice">Voice recording</option><option value="typed">Typed report</option>
            </select>
          </label>
          {entryMode === 'typed' ? <>
            <label htmlFor="typed-report">Describe the reported issue</label>
            <textarea id="typed-report" maxLength={20000} value={typedText} disabled={uploadLocked || typedUncertain}
              onChange={event => { setTypedText(event.target.value); typedSubmission.current = null }} />
            <p className="hint">Include the machine code, symptoms, when they began, and any reported readings with units. Review the saved text before confirming.</p>
            {checklistDraft && <button className="secondary" disabled={uploadLocked || typedUncertain} onClick={() => { setTypedText(checklistDraft); typedSubmission.current = null }}>Use checklist draft</button>}
            <button disabled={uploadLocked || !typedText.trim()} onClick={transcribe}>{busy ? 'Saving typed report…' : typedUncertain ? 'Retry same submission' : 'Save typed report for review'}</button>
          </> : <>
          <p>Use a recording under 30 seconds, up to 10 MiB.</p>
          <label htmlFor="speaking-mode">Speaking language
            <select id="speaking-mode" style={{ display: 'block', width: '100%', marginTop: 8 }} disabled={uploadLocked} value={speakingMode} onChange={(event) => setSpeakingMode(event.target.value)}>
              <option value="auto">Automatic detection</option>
              <option value="english">English</option><option value="hindi">Hindi / हिन्दी</option><option value="bengali">Bengali / বাংলা</option>
              <option value="hinglish">Hinglish / Hindi + English</option><option value="benglish">Benglish / Bengali + English</option>
              <option value="gujarati">Gujarati / ગુજરાતી</option><option value="kannada">Kannada / ಕನ್ನಡ</option><option value="malayalam">Malayalam / മലയാളം</option>
              <option value="marathi">Marathi / मराठी</option><option value="punjabi">Punjabi / ਪੰਜਾਬੀ</option><option value="tamil">Tamil / தமிழ்</option><option value="telugu">Telugu / తెలుగు</option>
            </select>
          </label>
          <p className="hint">This selection hints which language to expect; it does not translate speech or change the app interface. Review the transcript and its returned language tag.</p>
          <MicrophoneRecorder disabled={uploadLocked} active={view === 'worker'} onBusy={setRecordingBusy}
            onFile={(recorded) => { setFile(recorded); setInputKey((key) => key + 1); setError(''); setResumeError('') }} />
          <label className="upload" htmlFor="audio-file">
            <span><b className="attachment-plus" aria-hidden="true">+</b>{replacing ? 'Add a replacement recording' : 'Add an audio recording'}</span>
            <input key={inputKey} id="audio-file" type="file"
              accept=".wav,.mp3,.m4a,.ogg,.flac,.aac"
              disabled={uploadLocked}
              onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(''); setResumeError('') }} />
          </label>
          <p className="hint">WAV, MP3, M4A, OGG, FLAC or AAC</p>
          <AudioPreview file={file} />
          {file && !result && !recordingBusy && !busy && !resumeBusy && !uploadUncertain && <button className="secondary"
            onClick={() => { setFile(null); setInputKey((key) => key + 1); setError('') }}>
            Clear selected recording
          </button>}
          <button disabled={!file || uploadLocked} onClick={transcribe}>
            {busy ? 'Transcribing and saving…' : replacing ? 'Transcribe replacement' : 'Transcribe recording'}
          </button>
          <p className="hint">Clicking transcribe sends this recording to Gnani AI.</p>
          </>}
          {busy && entryMode === 'voice' && <p role="status">Waiting for the transcription and saved report…</p>}
          {error && <p className="error" role="alert">{error}</p>}
          {result && <p className="hint">{replacing
            ? `The next recording will be attempt ${result.attempt_number + 1} of this same report. Keep this page open during replacement.`
            : resumed ? 'Saved transcript reopened. No audio was sent to Gnani.' : result.model === 'manual-text' ? 'Typed report saved. Review its text on the right.' : 'Recording submitted. Review its transcript on the right.'}</p>}
          {review && review.decision !== 'rerecord_requested' &&
            <button className="secondary" onClick={startNewReport}>Start a new report</button>}
        </section>
        <section className="card report-review-card" aria-labelledby="transcript-heading" aria-busy={busy || reviewBusy}>
          <p className="eyebrow">02 / TRANSCRIPT</p>
          <h2 id="transcript-heading" tabIndex={-1}>{result?.model === 'manual-text' ? 'Your typed report' : 'What the system heard'}</h2>
          {result ? <>
            <span className={`review ${review ? 'saved' : ''}`}>
              {review ? (review.decision === 'rerecord_requested' ? 'Re-record requested' : 'Review saved') : 'Review required'}
            </span>
            <p className="transcript">{result.transcript}</p>
            <dl>
              <dt>Source</dt><dd>{result.model === 'manual-text' ? 'Typed by user' : result.model ?? 'Not returned'}</dd>
              <dt>Detected language</dt><dd>{result.detected_language_code ?? 'Not returned'}</dd>
              <dt>Report ID</dt><dd>{result.report_id}</dd>
              <dt>Attempt</dt><dd>{result.attempt_number}</dd>
            </dl>
            {review ? <div className="review-result" role="status">
              {review.decision === 'rerecord_requested' ? <>
                <h3>New recording requested</h3>
                <p>This transcript has not been verified. Its original text and recording are preserved.</p>
                <p className="hint">Choose a replacement recording on the left, then click Transcribe replacement. Earlier attempts remain saved.</p>
              </> : <>
                <h3>{review.decision === 'corrected' ? 'Corrected transcript' : 'Accepted transcript'}</h3>
                <p className="verified-text">{review.verified_transcript}</p>
                {reportLink?.reportId === result.report_id && <>
                  <button type="button" disabled={linkStatus !== 'idle'} onClick={linkChecklistReport}>
                    {linkStatus === 'saving' ? 'Linking…' : linkStatus === 'saved' ? 'Linked to checklist' : 'Link verified report to checklist'}
                  </button>
                  {linkError && <p className="error" role="alert">{linkError}</p>}
                </>}
                {!correctedLater&&<><ReportReadback key={result.attempt_id} attemptId={result.attempt_id} active={view === 'worker'} /><TranscriptCorrection key={`correction:${result.attempt_id}`} attemptId={result.attempt_id} text={review.verified_transcript??''} active={view==='worker'} onSaved={()=>{setCorrectedLater(true);setHistoryVersion(v=>v+1)}}/></>}
                {correctedLater&&<p>Open Report history and refresh reports to see the current corrected version.</p>}
                <p className="hint">Your review is saved. The original transcript above is unchanged.</p>
              </>}
            </div> : <>
              <p className="hint">Check the machine number, symptoms, temperature, units and negation before confirming. Later corrections create a new version in history.</p>
              {editing && <div className="editor">
                <label htmlFor="correction">Corrected transcript</label>
                <textarea id="correction" rows={6} maxLength={20000} value={draft}
                  disabled={locked} onChange={(event) => setDraft(event.target.value)} />
              </div>}
              <EquipmentCheck key={result.attempt_id} attemptId={result.attempt_id} text={checkText} onReady={setEquipmentApproval} onUse={value=>{setDraft(value);setEditing(true)}} disabled={locked}/>
              {checkText&&<details style={{margin:'12px 0'}}><summary>Listen before confirming (optional)</summary><ReportReadback key={`preview:${result.attempt_id}:${checkText}`} attemptId={result.attempt_id} previewText={checkText} active={view==='worker'}/></details>}
              {editing ? <div className="review-actions">
                <button disabled={locked || !draft.trim() || !equipmentReady} onClick={() => saveReview({ decision: 'corrected', corrected_transcript: draft.trim() })}>Save corrected transcript</button>
                <button className="secondary" disabled={locked} onClick={() => { setEditing(false); setReviewError('') }}>Cancel editing</button>
              </div> : <div className="review-actions">
                <button disabled={locked || !equipmentReady} onClick={() => saveReview({ decision: 'accepted' })}>Accept transcript</button>
                <button className="secondary" disabled={locked} onClick={() => { setEditing(true); setReviewError('') }}>Edit transcript</button>
                <button className="secondary" disabled={locked} onClick={() => saveReview({ decision: 'rerecord_requested' })}>Request re-recording</button>
              </div>}
              {reviewBusy && <p role="status">Saving your review…</p>}
              {reviewError && <p className="error" role="alert">{reviewError}</p>}
              {pending && !reviewBusy && !conflict && <button onClick={() => saveReview(pending)}>Retry same review</button>}
              {(pending || conflict) && <p className="hint">Keep this page open until the saved review is confirmed.</p>}
            </>}
          </> : <div className="transcript-placeholder"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h5"/></svg><h3>{busy?'Preparing your report…':'Your words, ready to review'}</h3><p>Record or type your report first. Check the machine name, issue, readings and units here before confirming.</p></div>}
        </section>
      </div>
      </div>
      {resumeError && <p className="error" role="alert">{resumeError}</p>}
      </>}
      {account.role === 'owner' && <div className="workspace-view" hidden={view !== 'redline'} aria-label="REDLINE inbox"><RedlineInbox active={view==='redline'} /></div>}
      {account.role === 'owner' && <>
        <div className="workspace-view" hidden={view !== 'edit-checklists'}><Checklists owner active={view === 'edit-checklists'} /></div>
        <div className="workspace-view" hidden={view !== 'submitted-checklists'}><SubmittedChecklists active={view === 'submitted-checklists'} onOpen={id => {
          setBoardReport({ id })
          setView('history')
        }} /></div>
      </>}
      {account.role === 'owner' && <div className="workspace-view" hidden={view !== 'work-board'} aria-label="Owner Work Board">
        <div hidden={directReportOpen}>
        <OwnerWorkBoard active={view === 'work-board' && !directReportOpen} onOpen={id => {
          setDirectReport({id})
          setDirectReportOpen(true)
        }} />
        </div>
        {directReport && <div hidden={!directReportOpen} className="direct-report-panel">
          <button type="button" className="secondary" style={{width:'auto',marginBottom:16}} onClick={()=>setDirectReportOpen(false)}>← Back to work board</button>
          <ReportHistory key={`direct:${historyVersion}`} detailOnly onResume={resumeReview} openRequest={directReport}
            resumeDisabled={resumeDisabled} resuming={resumeBusy} active={view === 'work-board' && directReportOpen}/>
        </div>}
      </div>}
      <div className="workspace-view" hidden={view !== 'overview'} aria-label="Factory overview">
        {account.role === 'owner' && <FactoryOverview active={view==='overview'} />}
      </div>
      <div className="workspace-view" hidden={view !== 'queue'} aria-label="Technician queue">
        {account.role !== 'worker' && <WorkQueue />}
      </div>
      <div className="workspace-view" hidden={view !== 'history'} aria-label="Report history">
      {account.role !== 'technician' && <ReportHistory key={historyVersion} onResume={resumeReview} openRequest={boardReport}
        resumeDisabled={resumeDisabled} resuming={resumeBusy} active={view === 'history'} />}
      </div>
      {account.role === 'owner' && <div className="workspace-view" hidden={view !== 'references'} aria-label="Machine reference documents"><MachineReferences /></div>}
      {account.role === 'owner' && <div className="workspace-view" hidden={view !== 'machines'} aria-label="Machine management"><MachineAdmin /></div>}
      {account.role === 'owner' && <div className="workspace-view" hidden={view !== 'accounts'} aria-label="Account management"><AccountAdmin /></div>}
      {account.role === 'owner' && <div className="workspace-view" hidden={view !== 'staffing'} aria-label="Worker machine assignments"><WorkerMachines /></div>}
      {account.role === 'owner' && <div className="workspace-view" hidden={view !== 'analytics'} aria-label="Maintenance analytics"><MaintenanceAnalytics /></div>}
      <div className="workspace-view" hidden={view !== 'ask'} aria-label="Ask SENTINEL"><AskSentinel active={view==='ask'} onReport={()=>setView('worker')} /></div>
      <FloatingChat visible={view !== 'ask'} onReport={() => setView('worker')} />
      <footer>Local demo · Reports and reviews are saved to the database · Recordings stay on this laptop · Saved reports and attempt history available</footer>
    </main>
  )
}

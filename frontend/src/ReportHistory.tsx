import TranscriptCorrection from './TranscriptCorrection'
import ReportReadback from './ReportReadback'
import { apiFetch } from './api'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import './ReportHistory.css'
import SavedExtraction from './SavedExtraction'

type Status = 'pending' | 'accepted' | 'corrected' | 'rerecord_requested'
type Summary = {
  report_id: string
  created_at: string
  latest_attempt_id: string | null
  latest_attempt_number: number | null
  latest_original_transcript: string | null
  detected_language_code: string | null
  verification_status: Status
}
type Page = { reports: Summary[]; total: number; limit: number; offset: number; has_more: boolean }
type Attempt = {
  attempt_id: string
  attempt_number: number
  created_at: string
  original_transcript: string
  model: string
  request_id: string | null
  detected_language_code: string | null
  verification_status: Status
  decision: Exclude<Status, 'pending'> | null
  corrected_transcript: string | null
  verified_transcript: string | null
  reviewed_at: string | null
  correction_of?:string|null
  correction_reason?:string|null
  corrected_by?:string|null
  correction_created_at?:string|null
}
type Report = { report_id: string; created_at: string; attempts: Attempt[] }
const PAGE_SIZE = 10
const labels: Record<Status, string> = {
  pending: 'Review required', accepted: 'Accepted', corrected: 'Corrected',
  rerecord_requested: 'Re-record requested',
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const nullableText = (v: unknown) => typeof v === 'string' || v === null
const id = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const status = (v: unknown): v is Status => typeof v === 'string' && Object.prototype.hasOwnProperty.call(labels, v)

function isSummary(v: unknown): v is Summary {
  if (!object(v) || !id(v.report_id) || !date(v.created_at) ||
    !status(v.verification_status) || !nullableText(v.detected_language_code)) return false
  if (v.latest_attempt_id === null) return v.latest_attempt_number === null &&
    v.latest_original_transcript === null && v.verification_status === 'pending'
  return id(v.latest_attempt_id) && integer(v.latest_attempt_number) && v.latest_attempt_number > 0 &&
    typeof v.latest_original_transcript === 'string'
}
function isPage(v: unknown, offset: number): v is Page {
  return object(v) && Array.isArray(v.reports) && v.reports.every(isSummary) &&
    integer(v.total) && v.limit === PAGE_SIZE && v.offset === offset &&
    v.reports.length <= PAGE_SIZE && typeof v.has_more === 'boolean' &&
    v.has_more === (offset + v.reports.length < v.total)
}
function isAttempt(v: unknown): v is Attempt {
  if (!object(v) || !id(v.attempt_id) || !integer(v.attempt_number) || v.attempt_number < 1 ||
    !date(v.created_at) || typeof v.original_transcript !== 'string' || typeof v.model !== 'string' ||
    !nullableText(v.request_id) || !nullableText(v.detected_language_code) || !status(v.verification_status) ||
    !nullableText(v.corrected_transcript) || !nullableText(v.verified_transcript) ||
    !(v.reviewed_at === null || date(v.reviewed_at))) return false
  if (v.verification_status === 'pending') return v.decision === null &&
    v.verified_transcript === null && v.corrected_transcript === null && v.reviewed_at === null
  if (v.decision !== v.verification_status || !date(v.reviewed_at)) return false
  if (v.decision === 'accepted') return v.verified_transcript === v.original_transcript && v.corrected_transcript === null
  if (v.decision === 'corrected') return typeof v.corrected_transcript === 'string' &&
    v.corrected_transcript.trim().length > 0 && v.verified_transcript === v.corrected_transcript
  return v.verified_transcript === null && v.corrected_transcript === null
}
export function isHistoryReport(v: unknown, reportId: string): v is Report {
  if (!object(v) || v.report_id !== reportId || !date(v.created_at) ||
    !Array.isArray(v.attempts) || !v.attempts.every(isAttempt)) return false
  const attempts: Attempt[] = v.attempts
  return new Set(attempts.map((a) => a.attempt_id)).size === attempts.length &&
    attempts.every((a, i) => i === 0 || a.attempt_number > attempts[i - 1].attempt_number)
}
function message(data: unknown, code: number) {
  return object(data) && typeof data.detail === 'string' ? data.detail : `History request failed (${code}).`
}
function when(value: string) { return new Date(value).toLocaleString() }

type Props = {
  detailOnly?: boolean
  openRequest?: { id: string } | null
  active?: boolean
  onResume: (reportId: string, attemptId: string) => Promise<void>
  resumeDisabled: boolean
  resuming: boolean
}

export default function ReportHistory({ onResume, resumeDisabled, resuming, active = true, openRequest, detailOnly = false }: Props) {
  const headingId=useId()
  const heading=useRef<HTMLHeadingElement|null>(null)
  useEffect(()=>{if(detailOnly&&active){heading.current?.focus();heading.current?.scrollIntoView({block:'start'})}},[detailOnly,active,openRequest])
  const [page, setPage] = useState<Page | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const listRequest = useRef<AbortController | null>(null)
  const detailRequest = useRef<AbortController | null>(null)
  useEffect(() => () => {
    listRequest.current?.abort()
    detailRequest.current?.abort()
    listRequest.current = null
    detailRequest.current = null
  }, [])

  async function loadPage(offset = 0) {
    listRequest.current?.abort()
    detailRequest.current?.abort()
    detailRequest.current = null
    setReport(null)
    setSelectedId(null)
    setDetailError('')
    setDetailLoading(false)
    const request = new AbortController()
    listRequest.current = request
    const timer = window.setTimeout(() => request.abort(), 30000)
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch(`/api/reports?limit=${PAGE_SIZE}&offset=${offset}`, { signal: request.signal, cache: 'no-store' })
      const data: unknown = await response.json()
      if (!response.ok) throw new Error(message(data, response.status))
      if (!isPage(data, offset)) throw new Error('The server returned an unexpected history response.')
      if (listRequest.current === request && !request.signal.aborted) setPage(data)
    } catch (caught) {
      if (listRequest.current === request) setError(request.signal.aborted
        ? 'History loading timed out. You can safely refresh the list.'
        : caught instanceof Error ? caught.message : 'Could not load history.')
    } finally {
      window.clearTimeout(timer)
      if (listRequest.current === request) setLoading(false)
    }
  }

  const openReport = useCallback(async (reportId: string) => {
    detailRequest.current?.abort()
    const request = new AbortController()
    detailRequest.current = request
    const timer = window.setTimeout(() => request.abort(), 30000)
    setSelectedId(reportId)
    setReport(null)
    setDetailLoading(true)
    setDetailError('')
    try {
      const response = await apiFetch(`/api/reports/${reportId}`, { signal: request.signal, cache: 'no-store' })
      const data: unknown = await response.json()
      if (!response.ok) throw new Error(message(data, response.status))
      if (!isHistoryReport(data, reportId)) throw new Error('The server returned an unexpected report response.')
      if (detailRequest.current === request && !request.signal.aborted) setReport(data)
    } catch (caught) {
      if (detailRequest.current === request) setDetailError(request.signal.aborted
        ? 'Report loading timed out. You can safely retry.'
        : caught instanceof Error ? caught.message : 'Could not load this report.')
    } finally {
      window.clearTimeout(timer)
      if (detailRequest.current === request) setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (openRequest) void openReport(openRequest.id)
  }, [openRequest, openReport])

  function renderAttempt(attempt:Attempt,index:number,report:Report){
    return (<article className={`history-attempt ${index === report.attempts.length - 1 ? 'history-latest-attempt' : ''}`} key={attempt.attempt_id}>
                <h4>{attempt.correction_of?'Corrected version':attempt.model === 'manual-text' ? 'Typed report version' : 'Recording attempt'} {attempt.attempt_number}{index === report.attempts.length - 1 ? ' · Latest' : ''}</h4>
                {attempt.correction_of&&<><p className="hint">Text corrected by {attempt.corrected_by??'an account'} · {when(attempt.correction_created_at??attempt.created_at)}. Reuses the earlier recording; no new transcription.</p><p>Reason: {attempt.correction_reason}</p><p className="hint">Correction of version {report.attempts.find(a=>a.attempt_id===attempt.correction_of)?.attempt_number??attempt.correction_of}. Earlier facts and work stay with their source version.</p></>}
                <span className="history-status">{labels[attempt.verification_status]}</span>
                <p className="hint">Version saved {when(attempt.created_at)} · {attempt.detected_language_code ?? 'Language not returned'}</p>
                <div className={index === report.attempts.length - 1 ? 'current-transcript' : 'archived-transcript'}>
                  <h5>{attempt.verified_transcript !== null ? (attempt.decision === 'corrected'||attempt.correction_of ? (index === report.attempts.length - 1 ? 'Current corrected transcript' : 'Corrected transcript · Earlier version') : 'Accepted transcript') : 'Latest text · Not verified'}</h5>
                  <p className="history-text"><strong>{attempt.verified_transcript ?? attempt.original_transcript}</strong></p>
                </div>
                {attempt.verified_transcript !== null && attempt.verified_transcript !== attempt.original_transcript && <div className="transcript-original">
                  <h5>{attempt.model === 'manual-text' ? 'Original typed text · Before correction' : 'Original transcript · Before correction'}</h5>
                  <p className="history-text">{attempt.original_transcript}</p>
                </div>}
                {attempt.correction_of && <p className="hint">For the text before this saved correction, expand Version history below.</p>}
                {attempt.verified_transcript === null && <p className="hint">{attempt.decision === 'rerecord_requested' ? 'A replacement was requested. This version is not verified.' : 'This latest version is awaiting review. Earlier accepted text is available in Version history.'}</p>}
                {index === report.attempts.length - 1 && attempt.verification_status === 'pending' && <>
                  <button disabled={resumeDisabled || loading || detailLoading}
                    onClick={() => onResume(report.report_id, attempt.attempt_id)}>
                    {resuming ? 'Opening review…' : 'Resume review'}
                  </button>
                  {resumeDisabled && !resuming && <p className="hint">Resume is available when the recording workspace is empty. Finish the active report or clear a selected recording first.</p>}
                </>}
                {index === report.attempts.length - 1 && attempt.verified_transcript !== null &&
                  <ReportReadback key={`readback:${attempt.attempt_id}`} attemptId={attempt.attempt_id} active={active} />}
                {index === report.attempts.length - 1 && attempt.verified_transcript !== null &&
                  <TranscriptCorrection key={`correction:${attempt.attempt_id}`} attemptId={attempt.attempt_id} text={attempt.verified_transcript} active={active} onSaved={()=>{void openReport(report.report_id)}}/>}
                {index === report.attempts.length - 1 && attempt.verified_transcript !== null &&
                  <SavedExtraction key={attempt.attempt_id} attemptId={attempt.attempt_id} transcript={attempt.verified_transcript} />}
                {attempt.reviewed_at && <p className="hint">Reviewed {when(attempt.reviewed_at)}</p>}
              </article>
    )
  }

  return (
    <section className="history card" aria-labelledby={headingId}>
      <div className="history-heading">
        <div><p className="eyebrow">03 / SAVED REPORTS</p><h2 id={headingId} ref={heading} tabIndex={-1}>{detailOnly?'Report and work log':'Report history'}</h2></div>
        {!detailOnly && <button className="secondary" disabled={loading} onClick={() => loadPage(0)}>
          {loading ? 'Loading…' : page ? 'Refresh reports' : 'Load saved reports'}
        </button>}
      </div>
      {!detailOnly && <p className="hint">Saved history for this demo factory. Resume the latest pending attempt to review it. Loading reports does not send audio to Gnani. Refresh the list after saving new work.</p>}
      {loading && <p role="status">Loading saved reports…</p>}
      {error && <p className="error" role="alert">{error} {page && 'The list below is from the previous successful load.'}</p>}
      {(page || selectedId) && <>
        {!detailOnly && page && <p className="hint">{page.total === 0 ? 'No saved reports yet.' : page.reports.length === 0
          ? 'No reports on this page. Refresh reports to return to the beginning.'
          : `Showing ${page.offset + 1}–${page.offset + page.reports.length} of ${page.total} reports`}</p>}
        <div className={!detailOnly && page ? "history-layout" : undefined}>
          {!detailOnly && page && <div>
            <ul className="history-list" aria-label="Saved reports">
              {page.reports.map((item) => <li key={item.report_id}>
                <button className="history-report" disabled={loading} aria-pressed={selectedId === item.report_id}
                  onClick={() => openReport(item.report_id)}>
                  <span className="history-status">{labels[item.verification_status]}</span>
                  <span className="history-preview">{item.latest_original_transcript ?? 'No recording saved'}</span>
                  <span className="hint">{when(item.created_at)} · Attempt {item.latest_attempt_number ?? '—'}</span>
                  <span className="hint history-id">{item.report_id}</span>
                </button>
              </li>)}
            </ul>
            <div className="history-pagination">
              <button className="secondary" disabled={loading || page.offset === 0} onClick={() => loadPage(Math.max(0, page.offset - PAGE_SIZE))}>Previous</button>
              <button className="secondary" disabled={loading || !page.has_more} onClick={() => loadPage(page.offset + PAGE_SIZE)}>Next</button>
            </div>
          </div>}
          <div className="history-detail" aria-busy={detailLoading}>
            {!selectedId && <p>Select a report to view its attempts and reviews.</p>}
            {detailLoading && <p role="status">Loading report history…</p>}
            {detailError && <>
              <p className="error" role="alert">{detailError}</p>
              <button className="secondary" onClick={() => selectedId && openReport(selectedId)}>Retry loading report</button>
            </>}
            {report && <>
              <h3>Report details</h3>
              <p className="hint history-id">{report.report_id}</p>
              <p className="hint">Created {when(report.created_at)} · Times shown in your local time</p>
              {report.attempts.length === 0 && <p>No recording attempts found.</p>}
              {report.attempts.length > 0 && renderAttempt(report.attempts[report.attempts.length - 1]!, report.attempts.length - 1, report)}
              {report.attempts.length > 1 && <details className="transcript-versions" key={`versions:${report.report_id}:${report.attempts.length}`}>
                <summary>Version history · {report.attempts.length - 1} earlier {report.attempts.length === 2 ? 'version' : 'versions'}</summary>
                <p className="hint">Earlier text is preserved below, newest first. Facts and work records remain associated with their source version.</p>
                {report.attempts.slice(0,-1).map((attempt,index)=>({attempt,index})).reverse().map(({attempt,index})=><details className="transcript-archived-version" key={attempt.attempt_id}>
                  <summary>Version {attempt.attempt_number} · {labels[attempt.verification_status]} · {when(attempt.created_at)}</summary>
                  {renderAttempt(attempt,index,report)}
                </details>)}
              </details>}
            </>}
          </div>
        </div>
      </>}
    </section>
  )
}

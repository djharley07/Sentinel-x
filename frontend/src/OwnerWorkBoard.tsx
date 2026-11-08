import { useEffect, useState } from 'react'
import { apiFetch } from './api'

const folders = { new: 'New Work', live: 'Live Work', done: 'Work Done' }
type Folder = keyof typeof folders
type Report = {
  report_id: string
  folder: Folder
  status: 'unassigned' | 'assigned' | 'in_progress' | 'completed'
  verification_status: string
  reviewed: boolean
  transcript: string | null
  reported_issue: string | null
  machine_name: string | null
  machine_code: string | null
  technician_name: string | null
  technician_code: string | null
  updated_at: string
  completed_at: string | null
  outcome: string | null
  action_note: string | null
}

function statusLabel(report: Report) {
  if (report.status === 'assigned') return 'Assigned · Waiting to start'
  if (report.status === 'in_progress') return '● Live · In progress'
  if (report.status === 'completed') return 'Completed'
  if (report.verification_status === 'pending') return 'Awaiting transcript review'
  if (report.verification_status === 'rerecord_requested') return 'Replacement recording requested'
  if (!report.reviewed) return 'Awaiting fact review'
  return report.machine_code ? 'Awaiting technician assignment' : 'Awaiting machine link'
}

export default function OwnerWorkBoard({ active, onOpen }: {
  active: boolean
  onOpen: (id: string) => void
}) {
  const [folder, setFolder] = useState<Folder>('new')
  const [scope, setScope] = useState('tab')
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [page, setPage] = useState<{ reports: Report[]; has_more: boolean } | null>(null)
  const [error, setError] = useState('')
  const [checkedAt, setCheckedAt] = useState('')
  const filter = scope === 'all' && query ? 'all' : folder

  useEffect(() => {
    if (!active) return
    let current: AbortController | null = null
    let disposed = false
    async function load() {
      if (current || document.hidden) return
      const request = new AbortController()
      current = request
      const timeout = window.setTimeout(() => request.abort(), 20000)
      try {
        const params = new URLSearchParams({ folder: filter, q: query, offset: String(offset) })
        const response = await apiFetch('/api/owner-work-board?' + params, { signal: request.signal })
        if (!response.ok) throw new Error('Could not refresh the work board (' + response.status + ').')
        const data = await response.json()
        if (!Array.isArray(data.reports) || typeof data.has_more !== 'boolean') {
          throw new Error('Unexpected work board response.')
        }
        if (!disposed) {
          setPage(data)
          setCheckedAt(new Date().toLocaleTimeString())
          setError('')
        }
      } catch (caught) {
        if (!disposed) setError(caught instanceof Error && !request.signal.aborted ? caught.message : 'Work board refresh timed out.')
      } finally {
        window.clearTimeout(timeout)
        current = null
      }
    }
    void load()
    const timer = window.setInterval(load, 30000)
    document.addEventListener('visibilitychange', load)
    return () => {
      disposed = true
      current?.abort()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', load)
    }
  }, [active, filter, query, offset, refresh])

  function changePage(next: number) {
    setPage(null)
    setError('')
    setCheckedAt('')
    setOffset(next)
  }

  return <section className="card owner-work-board">
    <p className="eyebrow">OWNER WORKSPACE / MAINTENANCE</p>
    <h2>Owner Work Board</h2>
    <p>Follow the latest report versions from review through technician completion. Earlier versions and work logs are in Report history.</p>
    <form className="board-search" onSubmit={event => {
      event.preventDefault()
      changePage(0)
      setQuery(draft.trim())
      setRefresh(value => value + 1)
    }}>
      <label>Search reports <input type="search" maxLength={150} value={draft}
        placeholder="Machine, issue, technician, or report ID" onChange={event => setDraft(event.target.value)} /></label>
      <label> Search scope <select value={scope} onChange={event => {
        if (query) changePage(0)
        setScope(event.target.value)
      }}><option value="tab">This tab</option><option value="all">All work &amp; history</option></select></label>
      <button type="submit">Search</button>
      {query && <button type="button" className="secondary" onClick={() => {
        setDraft('')
        setQuery('')
        changePage(0)
      }}>Clear search</button>}
    </form>
    <div className="redline-inbox-actions" aria-label="Work folders">
      {(Object.keys(folders) as Folder[]).map(key => <button key={key} type="button"
        className={folder === key && filter !== 'all' ? undefined : 'secondary'}
        aria-pressed={folder === key && filter !== 'all'} onClick={() => {
          if (key !== folder || filter === 'all') changePage(0)
          setFolder(key)
          setScope('tab')
        }}>{folders[key]}</button>)}
      <button type="button" className="secondary" onClick={() => setRefresh(value => value + 1)}>Refresh board</button>
    </div>
    <p className="hint">Live means the technician marked work in progress. The board checks for saved changes every 30 seconds while visible.</p>
    {query && <p>Results for “{query}” in {filter === 'all' ? 'All work & history' : folders[filter]}</p>}
    {checkedAt && <p className="hint">Last successful check {checkedAt}</p>}
    {error && <p className="error" role="alert">{error} {page && 'Showing results from the previous check.'}</p>}
    {!page && !error && <div className="workspace-loading" role="status"><span className="loading-dot"/>Loading saved work…<div className="loading-placeholder"/><div className="loading-placeholder"/></div>}
    {page && page.reports.length === 0 && <div className="workspace-empty"><span aria-hidden="true">✓</span><h3>{query ? 'No matching reports' : folder === 'done' ? 'Completed work will appear here' : folder === 'live' ? 'No work in progress' : 'Your new work inbox is clear'}</h3><p>{query ? 'Try a machine name, technician or report ID.' : 'Saved updates appear here after the next board refresh.'}</p></div>}
    {page?.reports.map(report => <article className={`redline-report-version board-report board-report-${report.folder}`} key={report.report_id}>
      <div className="board-report-heading"><h3>{report.machine_name ?? 'Unlinked report'} {report.machine_code && <small>{report.machine_code}</small>}</h3><span className={`work-status work-status-${report.folder}`}>{folders[report.folder]}</span></div>
      <p className="board-status-detail">{statusLabel(report)}</p>
      <p className="board-issue">{report.reported_issue ?? report.transcript ?? 'No transcript saved'}</p>
      {report.technician_name && <p className="board-technician"><span>Assigned technician</span>{report.technician_name} · {report.technician_code}</p>}
      {report.action_note && <p className="board-action-note">{report.action_note}</p>}
      {report.outcome && <p>Reported outcome {report.outcome.replaceAll('_', ' ')}</p>}
      <p className="hint">{report.completed_at && `Completed ${new Date(report.completed_at).toLocaleString()} · `}Last updated {new Date(report.updated_at).toLocaleString()} · {report.report_id}</p>
      <button type="button" className="secondary" onClick={() => onOpen(report.report_id)}>Open report and work log</button>
    </article>)}
    <div className="redline-inbox-actions">
      <button type="button" className="secondary" disabled={!offset} onClick={() => changePage(offset - 20)}>Previous</button>
      <button type="button" className="secondary" disabled={!page?.has_more} onClick={() => changePage(offset + 20)}>Next</button>
    </div>
  </section>
}

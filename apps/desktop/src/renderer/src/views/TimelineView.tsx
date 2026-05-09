import { useCallback, useEffect, useMemo, useState } from 'react'

type TeamPulseResponse = Awaited<ReturnType<typeof window.api.loadTeamPulse>>
type TeamPulseMember = TeamPulseResponse['members'][number]
type TeamPulseCell = TeamPulseMember['cells'][number]

const USER_COLORS = ['#2f80ed', '#c94840', '#2e8b57', '#c07c21', '#7d4bc2', '#008f8c']

function userColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return USER_COLORS[hash % USER_COLORS.length]!
}

function formatBucketHeader(iso: string, bucketSize: number): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  if (bucketSize >= 3600 && bucketSize % 3600 === 0) {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit'
    }).format(date)
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function formatBucketDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  }).format(date)
}

function isFreshBoundary(prevIso: string | undefined, currentIso: string): boolean {
  if (!prevIso) return true
  const prev = new Date(prevIso)
  const cur = new Date(currentIso)
  if (Number.isNaN(prev.getTime()) || Number.isNaN(cur.getTime())) return false
  return prev.toDateString() !== cur.toDateString()
}

type TimelineViewProps = {
  projectFolderPath: string | null
}

function TimelineView(_props: TimelineViewProps): React.JSX.Element {
  const [pulse, setPulse] = useState<TeamPulseResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected] = useState<{
    member: TeamPulseMember
    cell: TeamPulseCell
    bucketStart: string
  } | null>(null)

  const loadPulse = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const next = await window.api.loadTeamPulse({ bucketSize: 3600, bucketCount: 24 })
      setPulse(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshPulse = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    setError(null)
    try {
      await window.api.refreshTeamPulse({ bucketSize: 3600, bucketCount: 24 })
      const next = await window.api.loadTeamPulse({ bucketSize: 3600, bucketCount: 24 })
      setPulse(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadPulse()
    void window.api.refreshTeamPulse({ bucketSize: 3600, bucketCount: 24 }).then(loadPulse).catch(() => undefined)
  }, [loadPulse])

  const headerLabels = useMemo(() => {
    if (!pulse) return []
    return pulse.bucket_starts.map((iso, index, arr) => ({
      iso,
      label: formatBucketHeader(iso, pulse.bucket_size_seconds),
      dateLabel: isFreshBoundary(arr[index - 1], iso) ? formatBucketDate(iso) : null
    }))
  }, [pulse])

  if (loading && !pulse) {
    return (
      <section className="content-panel">
        <p className="chat-empty">loading team pulse...</p>
      </section>
    )
  }

  if (error && !pulse) {
    return (
      <section className="content-panel">
        <p className="chat-empty">team pulse failed: {error}</p>
        <button type="button" className="settings-form__button" onClick={() => void loadPulse()}>
          retry
        </button>
      </section>
    )
  }

  if (!pulse || pulse.members.length === 0) {
    return (
      <section className="content-panel">
        <p className="chat-empty">no project members yet</p>
      </section>
    )
  }

  return (
    <section className="content-panel timeline-pulse">
      <header className="timeline-pulse__header">
        <div>
          <h2 className="timeline-pulse__title">team pulse</h2>
          <p className="timeline-pulse__subtitle">
            last {pulse.bucket_starts.length} hour{pulse.bucket_starts.length === 1 ? '' : 's'} ·
            {' '}{pulse.members.length} member{pulse.members.length === 1 ? '' : 's'}
          </p>
        </div>
        <button
          type="button"
          className="settings-form__button"
          onClick={() => void refreshPulse()}
          disabled={refreshing}
        >
          {refreshing ? 'refreshing...' : 'refresh'}
        </button>
      </header>

      {error && <div className="content-status">{error}</div>}

      <div className="timeline-pulse__grid-wrapper">
        <table className="timeline-pulse__grid">
          <thead>
            <tr>
              <th className="timeline-pulse__corner">member</th>
              {headerLabels.map((header) => (
                <th key={header.iso} className="timeline-pulse__col-header">
                  {header.dateLabel && (
                    <div className="timeline-pulse__col-date">{header.dateLabel}</div>
                  )}
                  <div className="timeline-pulse__col-time">{header.label}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pulse.members.map((member) => {
              const color = userColor(member.display_name || member.agent_id)
              return (
                <tr key={member.agent_id}>
                  <th className="timeline-pulse__row-header">
                    <span className="timeline-pulse__row-dot" style={{ background: color }} />
                    <span>{member.display_name}</span>
                  </th>
                  {member.cells.map((cell, index) => {
                    const bucketStart = pulse.bucket_starts[index] ?? ''
                    const isEmpty = !cell.summary || cell.event_count === 0
                    const isSelected =
                      selected?.member.agent_id === member.agent_id &&
                      selected?.bucketStart === bucketStart
                    return (
                      <td
                        key={`${member.agent_id}:${bucketStart}`}
                        className={`timeline-pulse__cell${isEmpty ? ' timeline-pulse__cell--empty' : ''}${isSelected ? ' timeline-pulse__cell--selected' : ''}`}
                        title={
                          isEmpty
                            ? ''
                            : `${cell.summary} (${cell.event_count} event${cell.event_count === 1 ? '' : 's'})`
                        }
                        onClick={() => {
                          if (isEmpty) return
                          setSelected({ member, cell, bucketStart })
                        }}
                      >
                        {isEmpty ? null : (
                          <span className="timeline-pulse__cell-summary">{cell.summary}</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <aside className="timeline-pulse__detail">
          <button
            type="button"
            className="timeline-pulse__detail-close"
            onClick={() => setSelected(null)}
            aria-label="Close"
          >
            ×
          </button>
          <p className="timeline-pulse__detail-meta">
            {selected.member.display_name} · {formatBucketHeader(selected.bucketStart, pulse.bucket_size_seconds)} ·
            {' '}{selected.cell.event_count} event{selected.cell.event_count === 1 ? '' : 's'}
          </p>
          <p className="timeline-pulse__detail-summary">{selected.cell.summary}</p>
          {selected.cell.updated_at && (
            <p className="timeline-pulse__detail-updated">
              updated {new Date(selected.cell.updated_at).toLocaleString()}
            </p>
          )}
        </aside>
      )}
    </section>
  )
}

export default TimelineView

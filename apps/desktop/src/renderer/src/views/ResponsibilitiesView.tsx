import { useCallback, useEffect, useMemo, useState } from 'react'

type ResponsibilitiesResponse = Awaited<ReturnType<typeof window.api.loadResponsibilities>>
type ResponsibilityMember = ResponsibilitiesResponse['members'][number]

const USER_COLORS = ['#2f80ed', '#c94840', '#2e8b57', '#c07c21', '#7d4bc2', '#008f8c']

function userColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return USER_COLORS[hash % USER_COLORS.length]!
}

function formatUpdated(value: string | null): string {
  if (!value) return 'not yet generated'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `updated ${date.toLocaleString()}`
}

/**
 * Tiny markdown renderer scoped to what the responsibility prompt produces:
 * `## headings`, paragraphs, and `- bullet` lists. We avoid pulling a full
 * markdown dependency; this is plenty for the demo.
 */
function renderMarkdown(content: string): React.JSX.Element[] {
  const lines = content.split(/\r?\n/)
  const out: React.JSX.Element[] = []
  let listBuffer: string[] = []
  let paraBuffer: string[] = []

  function flushList(): void {
    if (listBuffer.length === 0) return
    out.push(
      <ul key={`ul-${out.length}`} className="responsibilities__list">
        {listBuffer.map((item, idx) => (
          <li key={idx}>{item}</li>
        ))}
      </ul>
    )
    listBuffer = []
  }
  function flushPara(): void {
    if (paraBuffer.length === 0) return
    out.push(
      <p key={`p-${out.length}`} className="responsibilities__paragraph">
        {paraBuffer.join(' ')}
      </p>
    )
    paraBuffer = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      flushList()
      flushPara()
      continue
    }
    if (/^#{1,6}\s+/.test(line)) {
      flushList()
      flushPara()
      const level = line.match(/^#+/)?.[0].length ?? 2
      const text = line.replace(/^#+\s+/, '')
      const Tag = (`h${Math.min(6, Math.max(2, level + 1))}` as unknown) as
        keyof React.JSX.IntrinsicElements
      out.push(
        <Tag key={`h-${out.length}`} className="responsibilities__heading">
          {text}
        </Tag>
      )
      continue
    }
    if (/^[-*]\s+/.test(line)) {
      flushPara()
      listBuffer.push(line.replace(/^[-*]\s+/, ''))
      continue
    }
    flushList()
    paraBuffer.push(line)
  }
  flushList()
  flushPara()
  return out
}

function ResponsibilitiesView(): React.JSX.Element {
  const [data, setData] = useState<ResponsibilitiesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const next = await window.api.loadResponsibilities()
      setData(next)
      if (!activeAgentId && next.members.length > 0) {
        const firstWithDoc = next.members.find((m) => m.content) ?? next.members[0]!
        setActiveAgentId(firstWithDoc.agent_id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [activeAgentId])

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    setError(null)
    try {
      await window.api.refreshTeamPulse({ bucketSize: 3600, bucketCount: 24 })
      const next = await window.api.loadResponsibilities()
      setData(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const activeMember: ResponsibilityMember | null = useMemo(() => {
    if (!data || !activeAgentId) return null
    return data.members.find((m) => m.agent_id === activeAgentId) ?? null
  }, [data, activeAgentId])

  if (loading && !data) {
    return (
      <section className="content-panel">
        <p className="chat-empty">loading responsibilities...</p>
      </section>
    )
  }

  if (error && !data) {
    return (
      <section className="content-panel">
        <p className="chat-empty">responsibilities failed: {error}</p>
        <button type="button" className="settings-form__button" onClick={() => void load()}>
          retry
        </button>
      </section>
    )
  }

  if (!data || data.members.length === 0) {
    return (
      <section className="content-panel">
        <p className="chat-empty">no project members yet</p>
      </section>
    )
  }

  return (
    <section className="content-panel responsibilities">
      <header className="responsibilities__header">
        <div>
          <h2 className="responsibilities__title">responsibilities</h2>
          <p className="responsibilities__subtitle">
            per-user summaries used to route prompts. regenerated on refresh.
          </p>
        </div>
        <button
          type="button"
          className="settings-form__button"
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          {refreshing ? 'refreshing...' : 'refresh my doc'}
        </button>
      </header>

      {error && <div className="content-status">{error}</div>}

      <div className="responsibilities__layout">
        <nav className="responsibilities__sidebar">
          {data.members.map((member) => {
            const isActive = member.agent_id === activeAgentId
            const color = userColor(member.display_name || member.agent_id)
            return (
              <button
                type="button"
                key={member.agent_id}
                className={`responsibilities__sidebar-item${isActive ? ' responsibilities__sidebar-item--active' : ''}`}
                onClick={() => setActiveAgentId(member.agent_id)}
              >
                <span className="responsibilities__sidebar-dot" style={{ background: color }} />
                <span className="responsibilities__sidebar-name">{member.display_name}</span>
                {member.content ? (
                  <span className="responsibilities__sidebar-words">
                    {member.word_count ? `${member.word_count}w` : 'doc'}
                  </span>
                ) : (
                  <span className="responsibilities__sidebar-empty">empty</span>
                )}
              </button>
            )
          })}
        </nav>

        <article className="responsibilities__panel">
          {activeMember ? (
            activeMember.content ? (
              <>
                <header className="responsibilities__panel-header">
                  <h3>{activeMember.display_name}</h3>
                  <p className="responsibilities__panel-meta">
                    {formatUpdated(activeMember.updated_at)}
                    {activeMember.word_count != null && ` · ${activeMember.word_count} words`}
                  </p>
                </header>
                <div className="responsibilities__panel-body">
                  {renderMarkdown(activeMember.content)}
                </div>
              </>
            ) : (
              <p className="chat-empty">
                {activeMember.display_name} has no responsibility doc yet. they need to open the
                app and refresh to generate one.
              </p>
            )
          ) : (
            <p className="chat-empty">select a member</p>
          )}
        </article>
      </div>
    </section>
  )
}

export default ResponsibilitiesView

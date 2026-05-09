import { useEffect, useMemo, useRef, useState } from 'react'

type ActivityNote = Awaited<ReturnType<typeof window.api.getActivityNotes>>[number]
type GraphEdge = { a: string; b: string; sharedFiles: string[] }

const USER_COLORS = ['#2f80ed', '#c94840', '#2e8b57', '#c07c21', '#7d4bc2', '#008f8c']
const NODE_W = 236
const NODE_H = 96
const DETAIL_W = 320
const GRAPH_PADDING = 32

function userColor(user: string): string {
  let hash = 0
  for (let i = 0; i < user.length; i++) hash = (hash * 31 + user.charCodeAt(i)) >>> 0
  return USER_COLORS[hash % USER_COLORS.length]!
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  return hash
}

function jitter(id: string, amount: number): number {
  return ((hashString(id) % 1000) / 1000 - 0.5) * amount
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function truncateText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  const truncated = normalized.slice(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  return `${(lastSpace > maxLength * 0.55 ? truncated.slice(0, lastSpace) : truncated).trim()}...`
}

function humanizePath(filePath: string): string {
  const filename = filePath.split(/[\\/]/).pop() ?? filePath
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function describeChangedFiles(files: string[]): string {
  if (files.length === 0) return ''
  const labels = [...new Set(files.map(humanizePath))]
  if (labels.length === 1) return labels[0]!
  return `${labels[0]} + ${labels.length - 1} file${labels.length === 2 ? '' : 's'}`
}

function compactPath(filePath: string): string {
  if (filePath.length <= 38) return filePath
  const parts = filePath.split(/[\\/]/).filter(Boolean)
  const tail = parts.slice(-2).join('/')
  return tail.length <= 34 ? `.../${tail}` : `...${tail.slice(-34)}`
}

function cleanDisplayTitle(title: string): string {
  return title
    .replace(/^(added|adjusted|changed|created|fixed|implemented|improved|investigated|refactored|updated|worked on)\s+/i, '')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleLooksLikeRequest(title: string): boolean {
  return /^(help|look|can|could|please|make|fix|update|add|build|implement|find|investigate|change|improve)\b/i.test(title)
}

function displayTitle(note: ActivityNote): string {
  const title = cleanDisplayTitle(note.title.trim())
  if (title && title !== 'Untitled session' && !titleLooksLikeRequest(title)) return truncateText(title, 80)
  const fileScope = describeChangedFiles(note.filesChanged)
  if (fileScope) return truncateText(fileScope, 80)
  return title || 'Untitled session'
}

function splitTitle(title: string): string[] {
  const words = truncateText(title, 78).split(/\s+/)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const safeWord = word.length > 28 ? truncateText(word, 28) : word
    if (!current) {
      current = safeWord
      continue
    }
    if (`${current} ${safeWord}`.length <= 30) {
      current = `${current} ${safeWord}`
      continue
    }
    lines.push(current)
    current = safeWord
  }
  if (current) lines.push(current)
  if (lines.length <= 2) return lines
  return [lines[0]!, truncateText(lines.slice(1).join(' '), 30)]
}

function parseNoteDate(raw: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number)
    return new Date(year!, month! - 1, day!)
  }
  return new Date(raw)
}

function noteTime(note: ActivityNote): number {
  const parsed = parseNoteDate(note.createdAt || note.date)
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime()
}

function compareNotes(a: ActivityNote, b: ActivityNote): number {
  return noteTime(a) - noteTime(b) || displayTitle(a).localeCompare(displayTitle(b))
}

function formatDate(note: ActivityNote, long = false): string {
  const raw = note.createdAt || note.date
  const parsed = parseNoteDate(raw)
  if (Number.isNaN(parsed.getTime())) return note.date || 'No date'
  return new Intl.DateTimeFormat(undefined, long
    ? { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric' }
  ).format(parsed)
}

function nodeMeta(note: ActivityNote): string {
  if (note.summary) return truncateText(note.summary, 48)
  if (note.filesChanged.length > 0) return truncateText(note.filesChanged.map(compactPath).join(', '), 48)
  return note.project || 'No changed files captured'
}

function fileCountLabel(count: number): string {
  if (count > 99) return '99+ files'
  return `${count} file${count === 1 ? '' : 's'}`
}

function buildEdges(notes: ActivityNote[]): GraphEdge[] {
  const edges: GraphEdge[] = []
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const setA = new Set(notes[i]!.filesChanged)
      const sharedFiles = notes[j]!.filesChanged.filter((file) => setA.has(file))
      if (sharedFiles.length > 0) {
        edges.push({ a: notes[i]!.id, b: notes[j]!.id, sharedFiles })
      }
    }
  }
  return edges
}

type Pos = { x: number; y: number; vx: number; vy: number }

function snapshotPositions(pos: Map<string, Pos>): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>()
  for (const [id, p] of pos) out.set(id, { x: p.x, y: p.y })
  return out
}

function buildTargets(notes: ActivityNote[], width: number, height: number): Map<string, { x: number; y: number }> {
  const targets = new Map<string, { x: number; y: number }>()
  const left = GRAPH_PADDING + NODE_W / 2
  const right = Math.max(left, width - GRAPH_PADDING - NODE_W / 2)
  const centerY = clamp(height / 2, NODE_H / 2 + GRAPH_PADDING, Math.max(NODE_H / 2 + GRAPH_PADDING, height - NODE_H / 2 - GRAPH_PADDING))
  const lanes = [-86, 86, 0, -154, 154]

  notes.forEach((note, index) => {
    const progress = notes.length === 1 ? 0.5 : index / (notes.length - 1)
    const targetY = centerY + lanes[index % lanes.length]!
    targets.set(note.id, {
      x: left + (right - left) * progress,
      y: clamp(targetY, NODE_H / 2 + 16, Math.max(NODE_H / 2 + 16, height - NODE_H / 2 - 16))
    })
  })

  return targets
}

function useForceSimulation(
  notes: ActivityNote[],
  edges: GraphEdge[],
  width: number,
  height: number
): Map<string, { x: number; y: number }> {
  const posRef = useRef<Map<string, Pos>>(new Map())
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map())

  useEffect(() => {
    if (notes.length === 0 || width === 0 || height === 0) return

    const targets = buildTargets(notes, width, height)
    const existing = posRef.current
    const next = new Map<string, Pos>()
    for (const note of notes) {
      const target = targets.get(note.id)!
      next.set(
        note.id,
        existing.get(note.id) ?? {
          x: target.x + jitter(note.id, 28),
          y: target.y + jitter(`${note.id}:y`, 28),
          vx: 0,
          vy: 0
        }
      )
    }
    posRef.current = next

    let stableCount = 0
    let handle: ReturnType<typeof setTimeout>

    function tick(): void {
      const pos = posRef.current
      const REPULSION = 42000
      const EDGE_STRENGTH = 0.024
      const TARGET_PULL_X = 0.018
      const TARGET_PULL_Y = 0.014
      const DAMPING = 0.78
      const ids = [...pos.keys()]

      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = pos.get(ids[i]!)!
          const b = pos.get(ids[j]!)!
          const dx = a.x - b.x
          const dy = a.y - b.y
          const distSq = dx * dx + dy * dy || 1
          const dist = Math.sqrt(distSq)
          const overlapBoost = Math.abs(dx) < NODE_W && Math.abs(dy) < NODE_H ? 1.8 : 1
          const force = (REPULSION * overlapBoost) / distSq
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          a.vx += fx
          a.vy += fy
          b.vx -= fx
          b.vy -= fy
        }
      }

      for (const edge of edges) {
        const a = pos.get(edge.a)
        const b = pos.get(edge.b)
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const desired = NODE_W + 54
        const force = (dist - desired) * EDGE_STRENGTH
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }

      let kinetic = 0
      for (const [id, p] of pos) {
        const target = targets.get(id)
        if (target) {
          p.vx += (target.x - p.x) * TARGET_PULL_X
          p.vy += (target.y - p.y) * TARGET_PULL_Y
        }
        p.vx *= DAMPING
        p.vy *= DAMPING
        p.x = clamp(p.x + p.vx, NODE_W / 2 + 12, Math.max(NODE_W / 2 + 12, width - NODE_W / 2 - 12))
        p.y = clamp(p.y + p.vy, NODE_H / 2 + 12, Math.max(NODE_H / 2 + 12, height - NODE_H / 2 - 12))
        kinetic += Math.abs(p.vx) + Math.abs(p.vy)
      }

      setPositions(snapshotPositions(pos))
      stableCount = kinetic < 0.12 * ids.length ? stableCount + 1 : 0
      if (stableCount < 8) handle = setTimeout(tick, 33)
    }

    handle = setTimeout(tick, 33)
    return () => clearTimeout(handle)
  }, [notes, edges, width, height])

  return positions
}

function DetailPanel({ note, docked, onClose }: { note: ActivityNote; docked: boolean; onClose: () => void }): React.JSX.Element {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const color = userColor(note.user)
  const title = displayTitle(note)

  return (
    <aside className={`timeline-detail ${docked ? '' : 'timeline-detail--overlay'}`}>
      <button className="timeline-detail__close" type="button" onClick={onClose} aria-label="Close">
        ×
      </button>
      <p className="timeline-detail__date">{formatDate(note, true)}</p>
      <h3>{title}</h3>
      <div className="timeline-detail__author">
        <span className="timeline-detail__dot" style={{ background: color }} />
        <span>{note.user || 'Unknown user'}</span>
      </div>

      {note.summary && (
        <section className="timeline-detail__section">
          <h4>Summary</h4>
          <p>{note.summary}</p>
        </section>
      )}

      {note.request && note.request !== title && (
        <section className="timeline-detail__section">
          <h4>Request</h4>
          <p>{note.request}</p>
        </section>
      )}

      {note.filesChanged.length > 0 && (
        <section className="timeline-detail__section">
          <h4>Files changed</h4>
          <ul className="timeline-detail__list">
            {note.filesChanged.map((file) => <li key={file}>{file}</li>)}
          </ul>
        </section>
      )}

      {note.toolsUsed.length > 0 && (
        <section className="timeline-detail__section">
          <h4>Tools used</h4>
          <div className="timeline-detail__chips">
            {note.toolsUsed.map((tool) => <span key={tool}>{tool}</span>)}
          </div>
        </section>
      )}

      {note.wikilinks.length > 0 && (
        <section className="timeline-detail__section">
          <h4>Links</h4>
          <div className="timeline-detail__chips">
            {note.wikilinks.map((link) => <span key={link}>{link}</span>)}
          </div>
        </section>
      )}
    </aside>
  )
}

type TimelineViewProps = {
  projectFolderPath: string | null
}

function TimelineView({ projectFolderPath }: TimelineViewProps): React.JSX.Element {
  const [notes, setNotes] = useState<ActivityNote[]>([])
  const [selected, setSelected] = useState<ActivityNote | null>(null)
  const containerRef = useRef<HTMLElement>(null)
  const [dims, setDims] = useState({ width: 0, height: 0 })

  useEffect(() => {
    if (!projectFolderPath) return
    void window.api.getActivityNotes(projectFolderPath).then(setNotes).catch(console.error)
  }, [projectFolderPath])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r) setDims({ width: r.width, height: r.height })
    })
    ro.observe(el)
    setDims({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const notesForGraph = useMemo(() => [...notes].sort(compareNotes), [notes])
  const edges = useMemo(() => buildEdges(notesForGraph), [notesForGraph])
  const detailDocked = Boolean(selected && dims.width >= 680)
  const graphWidth = detailDocked ? Math.max(0, dims.width - DETAIL_W) : dims.width
  const graphHeight = Math.max(dims.height, 1)
  const axisY = clamp(graphHeight / 2, 72, Math.max(72, graphHeight - 72))
  const positions = useForceSimulation(notesForGraph, edges, graphWidth, dims.height)

  if (!projectFolderPath) {
    return (
      <section className="content-panel">
        <p className="chat-empty">connect a project folder to see the activity graph</p>
      </section>
    )
  }

  return (
    <section className="content-panel timeline-panel" ref={containerRef}>
      {notesForGraph.length === 0 ? (
        <p className="chat-empty timeline-empty">no activity notes yet - enable activity graph in settings and run a session</p>
      ) : (
        <svg
          className="timeline-graph"
          width={graphWidth}
          height={graphHeight}
          role="img"
          aria-label="Activity graph"
          onClick={() => setSelected(null)}
        >
          <defs>
            <pattern id="timeline-grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#eef1f5" strokeWidth="1" />
            </pattern>
            <filter id="timeline-node-shadow" x="-20%" y="-35%" width="140%" height="170%">
              <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#111827" floodOpacity="0.12" />
            </filter>
            <filter id="timeline-node-selected-shadow" x="-20%" y="-35%" width="140%" height="170%">
              <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#111827" floodOpacity="0.18" />
            </filter>
          </defs>

          <rect width={graphWidth} height={graphHeight} fill="#fbfcfe" />
          <rect width={graphWidth} height={graphHeight} fill="url(#timeline-grid)" opacity="0.7" />
          <line
            className="timeline-graph__axis"
            x1={GRAPH_PADDING}
            y1={axisY}
            x2={Math.max(GRAPH_PADDING, graphWidth - GRAPH_PADDING)}
            y2={axisY}
          />

          {notesForGraph.map((note) => {
            const pos = positions.get(note.id)
            if (!pos) return null
            return <circle key={`tick-${note.id}`} className="timeline-graph__tick" cx={pos.x} cy={axisY} r={3} />
          })}

          {edges.map((edge) => {
            const a = positions.get(edge.a)
            const b = positions.get(edge.b)
            if (!a || !b) return null
            const selectedEdge = selected ? edge.a === selected.id || edge.b === selected.id : false
            const curve = clamp(Math.abs(b.x - a.x) * 0.32, 48, 130)
            const d = `M ${a.x} ${a.y} C ${a.x + curve} ${a.y}, ${b.x - curve} ${b.y}, ${b.x} ${b.y}`

            return (
              <g key={`${edge.a}:${edge.b}`}>
                <title>{edge.sharedFiles.map(compactPath).join(', ')}</title>
                <path
                  className="timeline-graph__edge"
                  d={d}
                  strokeWidth={Math.min(4, 1.4 + edge.sharedFiles.length * 0.55)}
                  opacity={selected ? (selectedEdge ? 0.8 : 0.16) : 0.42}
                />
              </g>
            )
          })}

          {notesForGraph.map((note) => {
            const pos = positions.get(note.id)
            if (!pos) return null
            const color = userColor(note.user)
            const isSelected = selected?.id === note.id
            const title = displayTitle(note)
            const titleLines = splitTitle(title)
            const meta = nodeMeta(note)
            const fileCount = note.filesChanged.length
            const author = truncateText(note.user || 'Unknown user', 18)

            return (
              <g
                key={note.id}
                className={`timeline-node ${isSelected ? 'timeline-node--selected' : ''}`}
                transform={`translate(${pos.x - NODE_W / 2} ${pos.y - NODE_H / 2})`}
                onClick={(event) => {
                  event.stopPropagation()
                  setSelected(note)
                }}
                tabIndex={0}
                role="button"
                aria-label={`${title}, ${note.user || 'Unknown user'}, ${formatDate(note, true)}`}
              >
                <title>{[title, note.summary, note.filesChanged.join(', ')].filter(Boolean).join(' - ')}</title>
                <rect
                  className="timeline-node__card"
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill={isSelected ? '#f8fbff' : '#ffffff'}
                  stroke={color}
                  strokeWidth={isSelected ? 2.4 : 1.3}
                  filter={isSelected ? 'url(#timeline-node-selected-shadow)' : 'url(#timeline-node-shadow)'}
                />
                <rect className="timeline-node__accent" width={5} height={NODE_H} rx={2.5} fill={color} />
                <circle cx={19} cy={19} r={5} fill={color} />
                <text className="timeline-node__eyebrow" x={31} y={22}>
                  {author} / {formatDate(note)}
                </text>
                {fileCount > 0 && (
                  <g className="timeline-node__chip" transform={`translate(${NODE_W - 68} 10)`}>
                    <rect width="56" height="20" rx="10" />
                    <text x="28" y="14" textAnchor="middle">{fileCountLabel(fileCount)}</text>
                  </g>
                )}
                <text className="timeline-node__title" x={16} y={48}>
                  {titleLines.map((line, index) => (
                    <tspan key={line} x={16} dy={index === 0 ? 0 : 15}>
                      {line}
                    </tspan>
                  ))}
                </text>
                <text className="timeline-node__meta" x={16} y={82}>
                  {meta}
                </text>
              </g>
            )
          })}
        </svg>
      )}

      {selected && <DetailPanel note={selected} docked={detailDocked} onClose={() => setSelected(null)} />}
    </section>
  )
}

export default TimelineView

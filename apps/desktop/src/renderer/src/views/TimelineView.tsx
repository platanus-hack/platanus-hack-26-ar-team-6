import { useEffect, useMemo, useRef, useState } from 'react'

type ActivityNote = Awaited<ReturnType<typeof window.api.getActivityNotes>>[number]
type GraphEdge = {
  a: string
  b: string
  kind: 'sequence' | 'topic'
  sharedFiles: string[]
  topicKey?: string
  topicLabel?: string
}

type TopicGroup = {
  key: string
  label: string
  noteIds: string[]
  color: string
  laneIndex: number
}

type GraphLayout = {
  edges: GraphEdge[]
  groups: TopicGroup[]
  height: number
  positions: Map<string, { x: number; y: number }>
  width: number
}

const USER_COLORS = ['#a855f7', '#c084fc', '#7c3aed', '#9333ea', '#d946ef', '#8b5cf6']
const TOPIC_COLORS = ['#a855f7', '#7c3aed', '#9333ea', '#c084fc', '#d946ef', '#8b5cf6']
const NODE_W = 236
const NODE_H = 96
const DETAIL_W = 320
const GRAPH_PADDING = 32
const LANE_TOP = 96
const LANE_GAP_Y = 154
const NODE_GAP_X = 92
const TOPIC_STOP_WORDS = new Set([
  'activity',
  'app',
  'code',
  'file',
  'files',
  'general',
  'local',
  'node',
  'nodes',
  'project',
  'response',
  'session',
  'summary',
  'title',
  'titles',
  'work'
])

function userColor(user: string): string {
  let hash = 0
  for (let i = 0; i < user.length; i++) hash = (hash * 31 + user.charCodeAt(i)) >>> 0
  return USER_COLORS[hash % USER_COLORS.length]!
}

function hashValue(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  return hash
}

function topicColor(topicKey: string): string {
  return TOPIC_COLORS[hashValue(topicKey) % TOPIC_COLORS.length]!
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

function titleCaseWord(word: string): string {
  const upper = word.toUpperCase()
  if (['API', 'CSS', 'DB', 'HTML', 'IPC', 'JSON', 'MCP', 'SQL', 'SVG', 'UI', 'URL', 'UX'].includes(upper)) {
    return upper
  }
  return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`
}

function normalizeTopicWord(word: string): string {
  const lower = word.toLowerCase()
  if (lower.length > 4 && lower.endsWith('s')) return lower.slice(0, -1)
  return lower
}

function topicWordsFromTitle(title: string): string[] {
  return title
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .split(' ')
    .map((word) => word.trim())
    .filter(Boolean)
    .map(normalizeTopicWord)
    .filter((word) => word.length > 2 && !TOPIC_STOP_WORDS.has(word))
}

function topicFromFilePath(filePath: string): { key: string; label: string } {
  const label = humanizePath(filePath)
  const key = topicWordsFromTitle(label).slice(0, 2).join(':') || normalizeTopicWord(label)
  return { key: `file:${key}`, label }
}

function topicForNote(note: ActivityNote): { key: string; label: string } {
  const words = topicWordsFromTitle(displayTitle(note))
  if (words.length >= 2) {
    const topicWords = words.slice(0, 2)
    return {
      key: `title:${topicWords.join(':')}`,
      label: topicWords.map(titleCaseWord).join(' ')
    }
  }

  if (note.filesChanged.length > 0) {
    return topicFromFilePath(note.filesChanged[0]!)
  }

  const fallback = words[0] ?? 'general'
  return {
    key: `fallback:${fallback}`,
    label: titleCaseWord(fallback)
  }
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

function sharedFilesBetween(a: ActivityNote, b: ActivityNote): string[] {
  const filesA = new Set(a.filesChanged)
  return b.filesChanged.filter((file) => filesA.has(file))
}

function buildTopicGroups(notes: ActivityNote[]): TopicGroup[] {
  const rawGroups = new Map<string, Omit<TopicGroup, 'color' | 'laneIndex'>>()
  for (const note of notes) {
    const topic = topicForNote(note)
    const group = rawGroups.get(topic.key)
    if (group) {
      group.noteIds.push(note.id)
      continue
    }
    rawGroups.set(topic.key, {
      key: topic.key,
      label: topic.label,
      noteIds: [note.id]
    })
  }

  const groups = [...rawGroups.values()]
  const repeatedGroups = groups.filter((group) => group.noteIds.length > 1)
  const singletonGroups = groups.filter((group) => group.noteIds.length === 1)
  const laneGroups =
    repeatedGroups.length > 0
      ? singletonGroups.length > 0
        ? repeatedGroups.concat({
            key: 'other',
            label: 'Other Activity',
            noteIds: singletonGroups.flatMap((group) => group.noteIds)
          })
        : repeatedGroups
      : groups.length > 1
        ? [{ key: 'all', label: 'All Activity', noteIds: groups.flatMap((group) => group.noteIds) }]
        : groups

  return laneGroups.map((group, laneIndex) => ({
    ...group,
    color: topicColor(group.key),
    laneIndex
  }))
}

function buildEdges(notes: ActivityNote[], groups: TopicGroup[]): GraphEdge[] {
  const edges: GraphEdge[] = []
  const noteById = new Map(notes.map((note) => [note.id, note]))
  const noteIndex = new Map(notes.map((note, index) => [note.id, index]))

  for (let i = 0; i < notes.length - 1; i++) {
    edges.push({
      a: notes[i]!.id,
      b: notes[i + 1]!.id,
      kind: 'sequence',
      sharedFiles: sharedFilesBetween(notes[i]!, notes[i + 1]!)
    })
  }

  for (const group of groups) {
    if (group.noteIds.length < 2 || group.key === 'all' || group.key === 'other') continue
    const ids = [...group.noteIds].sort((a, b) => (noteIndex.get(a) ?? 0) - (noteIndex.get(b) ?? 0))
    for (let i = 0; i < ids.length - 1; i++) {
      const a = noteById.get(ids[i]!)
      const b = noteById.get(ids[i + 1]!)
      if (!a || !b) continue
      edges.push({
        a: a.id,
        b: b.id,
        kind: 'topic',
        sharedFiles: sharedFilesBetween(a, b),
        topicKey: group.key,
        topicLabel: group.label
      })
    }
  }

  return edges
}

function buildGraphLayout(notes: ActivityNote[], availableWidth: number, availableHeight: number): GraphLayout {
  const groups = buildTopicGroups(notes)
  const groupByNote = new Map<string, TopicGroup>()
  for (const group of groups) {
    for (const noteId of group.noteIds) {
      groupByNote.set(noteId, group)
    }
  }

  const minStep = NODE_W + NODE_GAP_X
  const innerWidth = Math.max(0, availableWidth - GRAPH_PADDING * 2 - NODE_W)
  const step = notes.length <= 1 ? 0 : Math.max(minStep, innerWidth / (notes.length - 1))
  const width = Math.max(availableWidth || 1, GRAPH_PADDING * 2 + NODE_W + Math.max(0, notes.length - 1) * step)
  const height = Math.max(
    availableHeight || 1,
    LANE_TOP + Math.max(0, groups.length - 1) * LANE_GAP_Y + NODE_H / 2 + GRAPH_PADDING
  )
  const positions = new Map<string, { x: number; y: number }>()

  notes.forEach((note, index) => {
    const group = groupByNote.get(note.id)
    positions.set(note.id, {
      x: GRAPH_PADDING + NODE_W / 2 + index * step,
      y: LANE_TOP + (group?.laneIndex ?? 0) * LANE_GAP_Y
    })
  })

  return {
    edges: buildEdges(notes, groups),
    groups,
    height,
    positions,
    width
  }
}

function edgePath(edge: GraphEdge, a: { x: number; y: number }, b: { x: number; y: number }): string {
  const midX = (a.x + b.x) / 2
  if (edge.kind === 'topic') {
    const lift = a.y === b.y ? 42 : 18
    return `M ${a.x} ${a.y} C ${midX} ${a.y - lift}, ${midX} ${b.y - lift}, ${b.x} ${b.y}`
  }
  return `M ${a.x} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}`
}

function edgeTitle(edge: GraphEdge): string {
  if (edge.kind === 'sequence') {
    return edge.sharedFiles.length > 0
      ? `Next session - shared files: ${edge.sharedFiles.map(compactPath).join(', ')}`
      : 'Next session'
  }
  return edge.sharedFiles.length > 0
    ? `${edge.topicLabel} - shared files: ${edge.sharedFiles.map(compactPath).join(', ')}`
    : `${edge.topicLabel} topic`
}

function edgeOpacity(edge: GraphEdge, selected: ActivityNote | null): number {
  if (!selected) return edge.kind === 'topic' ? 0.74 : 0.46
  const selectedEdge = edge.a === selected.id || edge.b === selected.id
  if (!selectedEdge) return 0.12
  return edge.kind === 'topic' ? 0.92 : 0.72
}

function groupBandBounds(group: TopicGroup, graphWidth: number): { x: number; y: number; width: number; height: number } {
  return {
    x: 14,
    y: LANE_TOP + group.laneIndex * LANE_GAP_Y - NODE_H / 2 - 28,
    width: Math.max(0, graphWidth - 28),
    height: NODE_H + 56
  }
}

function groupLabel(group: TopicGroup): string {
  const count = group.noteIds.length
  return `${group.label} ${count > 1 ? `(${count})` : ''}`.trim()
}

function orderedEdges(edges: GraphEdge[]): GraphEdge[] {
  return edges
    .filter((edge) => edge.kind === 'sequence')
    .concat(edges.filter((edge) => edge.kind === 'topic'))
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
  const detailDocked = Boolean(selected && dims.width >= 680)
  const availableGraphWidth = detailDocked ? Math.max(0, dims.width - DETAIL_W) : dims.width
  const graph = useMemo(
    () => buildGraphLayout(notesForGraph, availableGraphWidth, dims.height),
    [availableGraphWidth, dims.height, notesForGraph]
  )

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
          width={graph.width}
          height={graph.height}
          role="img"
          aria-label="Activity graph"
          onClick={() => setSelected(null)}
        >
          <defs>
            <pattern id="timeline-grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M 28 0 L 0 0 0 28" fill="none" stroke="rgba(168, 85, 247, 0.08)" strokeWidth="1" />
            </pattern>
            <filter id="timeline-node-shadow" x="-20%" y="-35%" width="140%" height="170%">
              <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#000000" floodOpacity="0.4" />
            </filter>
            <filter id="timeline-node-selected-shadow" x="-20%" y="-35%" width="140%" height="170%">
              <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#a855f7" floodOpacity="0.3" />
            </filter>
          </defs>

          <rect width={graph.width} height={graph.height} fill="#09090b" />
          <rect width={graph.width} height={graph.height} fill="url(#timeline-grid)" opacity="1" />

          {graph.groups.map((group) => {
            const bounds = groupBandBounds(group, graph.width)
            const laneY = LANE_TOP + group.laneIndex * LANE_GAP_Y
            return (
              <g key={group.key}>
                <rect
                  className="timeline-topic-band"
                  x={bounds.x}
                  y={bounds.y}
                  width={bounds.width}
                  height={bounds.height}
                  rx={8}
                  fill={group.color}
                  opacity={group.noteIds.length > 1 ? 0.08 : 0.04}
                />
                <line
                  className="timeline-topic-lane"
                  x1={GRAPH_PADDING}
                  y1={laneY}
                  x2={Math.max(GRAPH_PADDING, graph.width - GRAPH_PADDING)}
                  y2={laneY}
                />
                <text className="timeline-topic-label" x={GRAPH_PADDING} y={bounds.y + 18} fill={group.color}>
                  {groupLabel(group)}
                </text>
              </g>
            )
          })}

          {orderedEdges(graph.edges).map((edge) => {
            const a = graph.positions.get(edge.a)
            const b = graph.positions.get(edge.b)
            if (!a || !b) return null
            const topicGroup = edge.topicKey ? graph.groups.find((group) => group.key === edge.topicKey) : undefined
            const stroke = edge.kind === 'topic' ? (topicGroup?.color ?? '#7c3aed') : '#4a4a5a'

            return (
              <g key={`${edge.kind}:${edge.a}:${edge.b}`}>
                <title>{edgeTitle(edge)}</title>
                <path
                  className={`timeline-graph__edge timeline-graph__edge--${edge.kind}`}
                  d={edgePath(edge, a, b)}
                  stroke={stroke}
                  strokeWidth={edge.kind === 'topic' ? Math.min(4.5, 2.4 + edge.sharedFiles.length * 0.45) : 2}
                  opacity={edgeOpacity(edge, selected)}
                />
              </g>
            )
          })}

          {notesForGraph.map((note) => {
            const pos = graph.positions.get(note.id)
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
                  fill={isSelected ? '#1c1c26' : '#16161d'}
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

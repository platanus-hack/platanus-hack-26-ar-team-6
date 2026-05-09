import { useEffect, useRef, useState } from 'react'

type ActivityNote = Awaited<ReturnType<typeof window.api.getActivityNotes>>[number]

// Assign a stable color per user based on their name
const USER_COLORS = ['#4a90d9', '#d9534a', '#5cb85c', '#f0ad4e', '#9b59b6', '#1abc9c']
function userColor(user: string): string {
  let hash = 0
  for (let i = 0; i < user.length; i++) hash = (hash * 31 + user.charCodeAt(i)) >>> 0
  return USER_COLORS[hash % USER_COLORS.length]!
}

// Build edges between sessions that share at least one modified file
function buildEdges(notes: ActivityNote[]): Array<{ a: string; b: string }> {
  const edges: Array<{ a: string; b: string }> = []
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const setA = new Set(notes[i]!.filesChanged)
      if (notes[j]!.filesChanged.some((f) => setA.has(f))) {
        edges.push({ a: notes[i]!.id, b: notes[j]!.id })
      }
    }
  }
  return edges
}

const NODE_W = 160
const NODE_H = 52

type Pos = { x: number; y: number; vx: number; vy: number }

function useForceSimulation(
  notes: ActivityNote[],
  edges: Array<{ a: string; b: string }>,
  width: number,
  height: number
): Map<string, { x: number; y: number }> {
  const posRef = useRef<Map<string, Pos>>(new Map())
  const [, setTick] = useState(0)

  useEffect(() => {
    if (notes.length === 0 || width === 0 || height === 0) return

    // Initialize positions in a grid, preserve existing if id already known
    const existing = posRef.current
    const next = new Map<string, Pos>()
    const cols = Math.ceil(Math.sqrt(notes.length))
    notes.forEach((n, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      next.set(n.id, existing.get(n.id) ?? {
        x: 80 + col * (NODE_W + 60) + Math.random() * 20,
        y: 80 + row * (NODE_H + 80) + Math.random() * 20,
        vx: 0,
        vy: 0
      })
    })
    posRef.current = next

    let stableCount = 0
    let handle: ReturnType<typeof setTimeout>

    function tick(): void {
      const pos = posRef.current
      const REPULSION = 12000
      const ATTRACTION = 0.06
      const DAMPING = 0.82
      const ids = [...pos.keys()]

      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = pos.get(ids[i])!
          const b = pos.get(ids[j])!
          const dx = a.x - b.x
          const dy = a.y - b.y
          const distSq = dx * dx + dy * dy || 1
          const dist = Math.sqrt(distSq)
          const f = REPULSION / distSq
          const fx = (dx / dist) * f
          const fy = (dy / dist) * f
          a.vx += fx; a.vy += fy
          b.vx -= fx; b.vy -= fy
        }
      }

      for (const edge of edges) {
        const a = pos.get(edge.a)
        const b = pos.get(edge.b)
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        a.vx += dx * ATTRACTION; a.vy += dy * ATTRACTION
        b.vx -= dx * ATTRACTION; b.vy -= dy * ATTRACTION
      }

      let kinetic = 0
      for (const p of pos.values()) {
        p.vx += (width / 2 - p.x) * 0.003
        p.vy += (height / 2 - p.y) * 0.003
        p.vx *= DAMPING; p.vy *= DAMPING
        p.x = Math.max(NODE_W / 2 + 8, Math.min(width - NODE_W / 2 - 8, p.x + p.vx))
        p.y = Math.max(NODE_H / 2 + 8, Math.min(height - NODE_H / 2 - 8, p.y + p.vy))
        kinetic += Math.abs(p.vx) + Math.abs(p.vy)
      }

      setTick((t) => t + 1)
      stableCount = kinetic < 0.08 * ids.length ? stableCount + 1 : 0
      if (stableCount < 6) handle = setTimeout(tick, 33)
    }

    handle = setTimeout(tick, 33)
    return () => clearTimeout(handle)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes.length, edges.length, width, height])

  const out = new Map<string, { x: number; y: number }>()
  for (const [id, p] of posRef.current) out.set(id, { x: p.x, y: p.y })
  return out
}

function DetailPanel({ note, onClose }: { note: ActivityNote; onClose: () => void }): React.JSX.Element {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      style={{
        position: 'absolute', top: 0, right: 0, width: 280, height: '100%',
        background: 'var(--color-bg, #fff)', borderLeft: '1px solid var(--color-border, #e0e0e0)',
        padding: '16px', overflowY: 'auto', zIndex: 10, boxSizing: 'border-box'
      }}
    >
      <button
        type="button"
        onClick={onClose}
        style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
        aria-label="Close"
      >
        ×
      </button>
      <p style={{ fontSize: 11, color: '#888', margin: '0 0 4px' }}>{note.date}</p>
      <h3 style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.4 }}>{note.title}</h3>
      <p style={{ fontSize: 12, color: userColor(note.user), margin: '0 0 12px', fontWeight: 600 }}>{note.user}</p>

      {note.filesChanged.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#555', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Files changed</p>
          <ul style={{ margin: 0, padding: '0 0 0 14px', fontSize: 11 }}>
            {note.filesChanged.map((f) => <li key={f} style={{ wordBreak: 'break-all', marginBottom: 2 }}>{f}</li>)}
          </ul>
        </div>
      )}

      {note.wikilinks.length > 0 && (
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#555', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Links</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {note.wikilinks.map((l) => (
              <span key={l} style={{ fontSize: 10, background: '#f0f0f0', borderRadius: 4, padding: '2px 6px', color: '#444' }}>
                {l}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
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

  const graphWidth = selected ? dims.width - 280 : dims.width
  const edges = buildEdges(notes)
  const positions = useForceSimulation(notes, edges, graphWidth, dims.height)

  if (!projectFolderPath) {
    return (
      <section className="content-panel">
        <p className="chat-empty">connect a project folder to see the activity graph</p>
      </section>
    )
  }

  return (
    <section
      className="content-panel"
      ref={containerRef}
      style={{ position: 'relative', overflow: 'hidden', padding: 0 }}
    >
      {notes.length === 0 ? (
        <p className="chat-empty">no activity notes yet — enable activity graph in settings and run a session</p>
      ) : (
        <svg
          width={graphWidth}
          height={dims.height}
          style={{ position: 'absolute', top: 0, left: 0 }}
          onClick={() => setSelected(null)}
        >
          {/* Edges */}
          {edges.map((e, i) => {
            const a = positions.get(e.a)
            const b = positions.get(e.b)
            if (!a || !b) return null
            return (
              <line
                key={i}
                x1={a.x} y1={a.y}
                x2={b.x} y2={b.y}
                stroke="#d0d0d0"
                strokeWidth={1.5}
              />
            )
          })}

          {/* Session nodes */}
          {notes.map((note) => {
            const pos = positions.get(note.id)
            if (!pos) return null
            const { x, y } = pos
            const color = userColor(note.user)
            const isSelected = selected?.id === note.id
            const title = note.title.length > 22 ? `${note.title.slice(0, 21)}…` : note.title
            const subtitle = note.date

            return (
              <g
                key={note.id}
                onClick={(e) => { e.stopPropagation(); setSelected(note) }}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={x - NODE_W / 2}
                  y={y - NODE_H / 2}
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill={isSelected ? color : '#fff'}
                  stroke={color}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  style={{ filter: isSelected ? 'none' : 'drop-shadow(0 1px 3px rgba(0,0,0,0.10))' }}
                />
                <text
                  x={x}
                  y={y - 6}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={600}
                  fill={isSelected ? '#fff' : '#222'}
                >
                  {title}
                </text>
                <text
                  x={x}
                  y={y + 12}
                  textAnchor="middle"
                  fontSize={10}
                  fill={isSelected ? 'rgba(255,255,255,0.8)' : color}
                >
                  {note.user || subtitle}
                </text>
                <text
                  x={x}
                  y={y + 24}
                  textAnchor="middle"
                  fontSize={9}
                  fill={isSelected ? 'rgba(255,255,255,0.6)' : '#aaa'}
                >
                  {subtitle}
                </text>
              </g>
            )
          })}
        </svg>
      )}

      {selected && <DetailPanel note={selected} onClose={() => setSelected(null)} />}
    </section>
  )
}

export default TimelineView

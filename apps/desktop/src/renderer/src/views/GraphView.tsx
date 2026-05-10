import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type ProjectGraphResponse = Awaited<ReturnType<typeof window.api.loadProjectGraph>>
type GraphNode = ProjectGraphResponse['nodes'][number]
type GraphEdge = ProjectGraphResponse['edges'][number]

type SimNode = GraphNode & {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  fixed?: boolean
}

type SimEdge = GraphEdge & {
  sourceNode: SimNode
  targetNode: SimNode
}

const NODE_COLORS: Record<GraphNode['kind'], string> = {
  agent: '#7dd3fc',
  doc: '#fbbf24',
  event: '#a78bfa'
}

const EDGE_COLORS: Record<GraphEdge['kind'], string> = {
  authored: 'rgba(180, 200, 220, 0.45)',
  asked: 'rgba(244, 114, 182, 0.55)',
  provenance: 'rgba(160, 220, 180, 0.4)'
}

const NODE_RADIUS_BY_KIND: Record<GraphNode['kind'], number> = {
  agent: 12,
  doc: 7,
  event: 5
}

function buildSim(nodes: GraphNode[], edges: GraphEdge[]): { nodes: SimNode[]; edges: SimEdge[] } {
  const sim: SimNode[] = nodes.map((node, idx) => {
    const angle = (idx / Math.max(1, nodes.length)) * Math.PI * 2
    const ring = node.kind === 'agent' ? 80 : node.kind === 'doc' ? 200 : 320
    return {
      ...node,
      x: Math.cos(angle) * ring + (Math.random() - 0.5) * 30,
      y: Math.sin(angle) * ring + (Math.random() - 0.5) * 30,
      vx: 0,
      vy: 0,
      radius: NODE_RADIUS_BY_KIND[node.kind]
    }
  })
  const byId = new Map(sim.map((n) => [n.id, n]))
  const simEdges: SimEdge[] = []
  for (const edge of edges) {
    const a = byId.get(edge.source)
    const b = byId.get(edge.target)
    if (!a || !b) continue
    simEdges.push({ ...edge, sourceNode: a, targetNode: b })
  }
  return { nodes: sim, edges: simEdges }
}

function step(nodes: SimNode[], edges: SimEdge[], dt: number): void {
  const repulsion = 1800
  const spring = 0.04
  const damping = 0.82
  const gravity = 0.012

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const distSq = dx * dx + dy * dy + 0.01
      const dist = Math.sqrt(distSq)
      const force = repulsion / distSq
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.vx -= fx * dt
      a.vy -= fy * dt
      b.vx += fx * dt
      b.vy += fy * dt
    }
  }

  for (const edge of edges) {
    const a = edge.sourceNode
    const b = edge.targetNode
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.sqrt(dx * dx + dy * dy) + 0.01
    const target = a.kind === 'agent' && b.kind === 'agent' ? 140 : 90
    const diff = dist - target
    const fx = (dx / dist) * diff * spring
    const fy = (dy / dist) * diff * spring
    a.vx += fx * dt
    a.vy += fy * dt
    b.vx -= fx * dt
    b.vy -= fy * dt
  }

  for (const n of nodes) {
    if (n.fixed) {
      n.vx = 0
      n.vy = 0
      continue
    }
    n.vx -= n.x * gravity * dt
    n.vy -= n.y * gravity * dt
    n.vx *= damping
    n.vy *= damping
    n.x += n.vx * dt
    n.y += n.vy * dt
  }
}

function GraphView(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const animationRef = useRef<number | null>(null)
  const stateRef = useRef<{
    nodes: SimNode[]
    edges: SimEdge[]
    transform: { x: number; y: number; scale: number }
    hoverId: string | null
    dragNode: SimNode | null
    dragPan: { x: number; y: number } | null
  }>({
    nodes: [],
    edges: [],
    transform: { x: 0, y: 0, scale: 1 },
    hoverId: null,
    dragNode: null,
    dragPan: null
  })

  const [graph, setGraph] = useState<ProjectGraphResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [includeLocal, setIncludeLocal] = useState(false)
  const [selected, setSelected] = useState<GraphNode | null>(null)

  const fetchGraph = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await window.api.loadProjectGraph({ includeLocal })
      setGraph(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }, [includeLocal])

  useEffect(() => {
    void fetchGraph()
  }, [fetchGraph])

  useEffect(() => {
    if (!graph) return
    const built = buildSim(graph.nodes, graph.edges)
    stateRef.current.nodes = built.nodes
    stateRef.current.edges = built.edges
    stateRef.current.transform = { x: 0, y: 0, scale: 1 }
    stateRef.current.hoverId = null
    stateRef.current.dragNode = null
    stateRef.current.dragPan = null
  }, [graph])

  const stats = useMemo(() => {
    if (!graph) return { agents: 0, docs: 0, events: 0, edges: 0 }
    let agents = 0
    let docs = 0
    let events = 0
    for (const n of graph.nodes) {
      if (n.kind === 'agent') agents++
      else if (n.kind === 'doc') docs++
      else if (n.kind === 'event') events++
    }
    return { agents, docs, events, edges: graph.edges.length }
  }, [graph])

  // Render loop.
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    let width = container.clientWidth
    let height = container.clientHeight
    let dpr = Math.min(window.devicePixelRatio || 1, 2)

    function resize(): void {
      if (!canvas || !container) return
      width = container.clientWidth
      height = container.clientHeight
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function frame(): void {
      const state = stateRef.current
      step(state.nodes, state.edges, 1)
      if (!ctx) return

      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, width, height)

      ctx.translate(width / 2 + state.transform.x, height / 2 + state.transform.y)
      ctx.scale(state.transform.scale, state.transform.scale)

      for (const edge of state.edges) {
        ctx.beginPath()
        ctx.moveTo(edge.sourceNode.x, edge.sourceNode.y)
        ctx.lineTo(edge.targetNode.x, edge.targetNode.y)
        ctx.lineWidth = edge.kind === 'asked' ? Math.min(0.6 + edge.weight * 0.4, 4) : 0.8
        ctx.strokeStyle = EDGE_COLORS[edge.kind]
        ctx.stroke()
      }

      for (const node of state.nodes) {
        const isHover = state.hoverId === node.id
        const isSelected = selected?.id === node.id
        ctx.beginPath()
        ctx.arc(node.x, node.y, node.radius + (isHover ? 2 : 0), 0, Math.PI * 2)
        ctx.fillStyle = NODE_COLORS[node.kind]
        ctx.fill()
        if (isSelected) {
          ctx.lineWidth = 2
          ctx.strokeStyle = '#fff'
          ctx.stroke()
        }
        if (node.kind === 'agent' || isHover || isSelected) {
          ctx.fillStyle = 'rgba(230, 240, 255, 0.92)'
          ctx.font = '11px ui-sans-serif, system-ui'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.fillText(node.label, node.x, node.y + node.radius + 4)
        }
      }

      ctx.restore()
      animationRef.current = requestAnimationFrame(frame)
    }
    animationRef.current = requestAnimationFrame(frame)

    function toWorld(clientX: number, clientY: number): { x: number; y: number } {
      if (!canvas) return { x: 0, y: 0 }
      const rect = canvas.getBoundingClientRect()
      const px = clientX - rect.left
      const py = clientY - rect.top
      const state = stateRef.current
      const x = (px - width / 2 - state.transform.x) / state.transform.scale
      const y = (py - height / 2 - state.transform.y) / state.transform.scale
      return { x, y }
    }

    function pickNode(x: number, y: number): SimNode | null {
      const state = stateRef.current
      let best: SimNode | null = null
      let bestDist = Infinity
      for (const n of state.nodes) {
        const dx = n.x - x
        const dy = n.y - y
        const d = dx * dx + dy * dy
        const r = (n.radius + 4) * (n.radius + 4)
        if (d <= r && d < bestDist) {
          bestDist = d
          best = n
        }
      }
      return best
    }

    function onMove(e: MouseEvent): void {
      const state = stateRef.current
      if (state.dragNode) {
        const w = toWorld(e.clientX, e.clientY)
        state.dragNode.x = w.x
        state.dragNode.y = w.y
        state.dragNode.vx = 0
        state.dragNode.vy = 0
        return
      }
      if (state.dragPan) {
        state.transform.x += e.movementX
        state.transform.y += e.movementY
        return
      }
      const w = toWorld(e.clientX, e.clientY)
      const hit = pickNode(w.x, w.y)
      state.hoverId = hit?.id ?? null
      if (canvas) canvas.style.cursor = hit ? 'pointer' : 'grab'
    }

    function onDown(e: MouseEvent): void {
      const state = stateRef.current
      const w = toWorld(e.clientX, e.clientY)
      const hit = pickNode(w.x, w.y)
      if (hit) {
        hit.fixed = true
        state.dragNode = hit
        setSelected({ id: hit.id, kind: hit.kind, label: hit.label, meta: hit.meta })
      } else {
        state.dragPan = { x: e.clientX, y: e.clientY }
      }
    }

    function onUp(): void {
      const state = stateRef.current
      if (state.dragNode) state.dragNode.fixed = false
      state.dragNode = null
      state.dragPan = null
    }

    function onWheel(e: WheelEvent): void {
      e.preventDefault()
      const state = stateRef.current
      const factor = Math.exp(-e.deltaY * 0.001)
      state.transform.scale = Math.min(4, Math.max(0.2, state.transform.scale * factor))
    }

    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current)
      ro.disconnect()
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [graph, selected])

  return (
    <section className="content-panel graph-view">
      <div className="graph-toolbar">
        <div className="graph-toolbar__legend">
          <span className="graph-legend graph-legend--agent">agents {stats.agents}</span>
          <span className="graph-legend graph-legend--doc">docs {stats.docs}</span>
          <span className="graph-legend graph-legend--event">events {stats.events}</span>
          <span className="graph-legend">edges {stats.edges}</span>
        </div>
        <label className="graph-toolbar__toggle">
          <input
            type="checkbox"
            checked={includeLocal}
            onChange={(e) => setIncludeLocal(e.target.checked)}
          />
          include private
        </label>
        <button
          type="button"
          className="graph-toolbar__refresh"
          onClick={() => void fetchGraph()}
          disabled={isLoading}
        >
          {isLoading ? 'loading…' : 'refresh'}
        </button>
      </div>
      {error && <div className="content-status">graph load failed: {error}</div>}
      <div ref={containerRef} className="graph-canvas-host">
        <canvas ref={canvasRef} className="graph-canvas" />
        {!error && graph && graph.nodes.length === 0 && (
          <div className="graph-empty">
            <div className="graph-empty__title">no nodes yet</div>
            <div className="graph-empty__hint">
              the graph projects global memory documents, events, and agent context exchanges.
              run the assistant a few times so the updater publishes global entries — or toggle
              "include private" above to show local memory.
            </div>
          </div>
        )}
        {selected && (
          <aside className="graph-detail">
            <header className="graph-detail__header">
              <span className={`graph-legend graph-legend--${selected.kind}`}>{selected.kind}</span>
              <button
                type="button"
                className="graph-detail__close"
                onClick={() => setSelected(null)}
                aria-label="close"
              >
                ×
              </button>
            </header>
            <div className="graph-detail__title">{selected.label}</div>
            {Boolean(selected.meta?.preview) && (
              <p className="graph-detail__preview">{String(selected.meta.preview)}</p>
            )}
            {Boolean(selected.meta?.domain_summary) && (
              <p className="graph-detail__preview">{String(selected.meta.domain_summary)}</p>
            )}
            {Boolean(selected.meta?.updated_at) && (
              <div className="graph-detail__meta">updated {String(selected.meta.updated_at)}</div>
            )}
            {Boolean(selected.meta?.created_at) && (
              <div className="graph-detail__meta">created {String(selected.meta.created_at)}</div>
            )}
          </aside>
        )}
      </div>
    </section>
  )
}

export default GraphView

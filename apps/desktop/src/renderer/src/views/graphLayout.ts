export type GraphLayoutNodeKind = 'agent' | 'doc' | 'event'
export type GraphLayoutEdgeKind = 'authored' | 'asked' | 'provenance'

export type GraphLayoutNodeInput = {
  id: string
  kind: GraphLayoutNodeKind
  label: string
  meta: Record<string, unknown>
}

export type GraphLayoutEdgeInput = {
  source: string
  target: string
  kind: GraphLayoutEdgeKind
  weight: number
  meta: Record<string, unknown>
}

export type GraphLayoutNode = GraphLayoutNodeInput & {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  fixed?: boolean
}

export type GraphLayoutEdge = GraphLayoutEdgeInput & {
  sourceNode: GraphLayoutNode
  targetNode: GraphLayoutNode
}

export type CachedNodeState = { x: number; y: number; vx: number; vy: number }

export type LayoutMotion = {
  framesRemaining: number
  settled: boolean
}

const NODE_RADIUS_BY_KIND: Record<GraphLayoutNodeKind, number> = {
  agent: 12,
  doc: 7,
  event: 5
}

export const LAYOUT_ACTIVE_FRAMES = 48
const LAYOUT_DRAG_FRAMES = 24
const LAYOUT_PREWARM_MAX_ITERS = 220
const LAYOUT_PREWARM_MIN_ITERS = 48
const LAYOUT_SETTLED_MAX_SPEED = 0.015
const LAYOUT_SPEED_LIMIT = 18

export function buildSim(
  nodes: GraphLayoutNodeInput[],
  edges: GraphLayoutEdgeInput[],
  cache?: Map<string, CachedNodeState>,
  random: () => number = Math.random
): { nodes: GraphLayoutNode[]; edges: GraphLayoutEdge[] } {
  const sim: GraphLayoutNode[] = nodes.map((node, idx) => {
    const cached = cache?.get(node.id)
    if (cached) {
      return {
        ...node,
        x: cached.x,
        y: cached.y,
        vx: cached.vx,
        vy: cached.vy,
        radius: NODE_RADIUS_BY_KIND[node.kind]
      }
    }
    const angle = (idx / Math.max(1, nodes.length)) * Math.PI * 2
    const ringScale = Math.max(1, Math.sqrt(nodes.length / 30))
    const ring = (node.kind === 'agent' ? 80 : node.kind === 'doc' ? 200 : 320) * ringScale
    return {
      ...node,
      x: Math.cos(angle) * ring + (random() - 0.5) * 30,
      y: Math.sin(angle) * ring + (random() - 0.5) * 30,
      vx: 0,
      vy: 0,
      radius: NODE_RADIUS_BY_KIND[node.kind]
    }
  })
  const byId = new Map(sim.map((node) => [node.id, node]))
  const simEdges: GraphLayoutEdge[] = []
  for (const edge of edges) {
    const a = byId.get(edge.source)
    const b = byId.get(edge.target)
    if (!a || !b) continue
    simEdges.push({ ...edge, sourceNode: a, targetNode: b })
  }
  return { nodes: sim, edges: simEdges }
}

export function prewarmLayout(nodes: GraphLayoutNode[], edges: GraphLayoutEdge[]): void {
  const iters = Math.min(
    LAYOUT_PREWARM_MAX_ITERS,
    Math.max(LAYOUT_PREWARM_MIN_ITERS, Math.floor(48 + Math.sqrt(nodes.length) * 10))
  )
  for (let i = 0; i < iters; i++) {
    stepLayout(nodes, edges, 1)
  }
  stopLayout(nodes)
}

export function createLayoutMotion(opts: { hasUncachedNodes: boolean }): LayoutMotion {
  return opts.hasUncachedNodes
    ? { framesRemaining: LAYOUT_ACTIVE_FRAMES, settled: false }
    : { framesRemaining: 0, settled: true }
}

export function warmLayout(motion: LayoutMotion, frames = LAYOUT_DRAG_FRAMES): void {
  motion.framesRemaining = Math.max(motion.framesRemaining, frames)
  motion.settled = false
}

export function stepSettlingLayout(
  nodes: GraphLayoutNode[],
  edges: GraphLayoutEdge[],
  motion: LayoutMotion,
  dt = 1
): boolean {
  if (motion.settled) return false

  const maxSpeed = stepLayout(nodes, edges, dt)
  motion.framesRemaining = Math.max(0, motion.framesRemaining - 1)

  if (motion.framesRemaining === 0 && maxSpeed <= LAYOUT_SETTLED_MAX_SPEED) {
    stopLayout(nodes)
    motion.settled = true
    motion.framesRemaining = 0
  }
  return true
}

function stepLayout(nodes: GraphLayoutNode[], edges: GraphLayoutEdge[], dt: number): number {
  const repulsion = 1400
  const spring = 0.035
  const damping = 0.76
  const gravity = 0.012

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const distSq = Math.max(dx * dx + dy * dy, 36)
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

  let maxSpeed = 0
  for (const node of nodes) {
    if (node.fixed) {
      node.vx = 0
      node.vy = 0
      continue
    }
    node.vx -= node.x * gravity * dt
    node.vy -= node.y * gravity * dt
    node.vx *= damping
    node.vy *= damping

    const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy)
    if (speed > LAYOUT_SPEED_LIMIT) {
      const scale = LAYOUT_SPEED_LIMIT / speed
      node.vx *= scale
      node.vy *= scale
    }

    node.x += node.vx * dt
    node.y += node.vy * dt
    maxSpeed = Math.max(maxSpeed, Math.sqrt(node.vx * node.vx + node.vy * node.vy))
  }
  return maxSpeed
}

function stopLayout(nodes: GraphLayoutNode[]): void {
  for (const node of nodes) {
    node.vx = 0
    node.vy = 0
  }
}

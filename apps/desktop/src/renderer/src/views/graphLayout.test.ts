import { describe, expect, it } from 'vitest'

import {
  LAYOUT_ACTIVE_FRAMES,
  buildSim,
  createLayoutMotion,
  stepSettlingLayout,
  warmLayout,
  type GraphLayoutEdgeInput,
  type GraphLayoutNodeInput
} from './graphLayout'

function privateGraph(size: number): {
  nodes: GraphLayoutNodeInput[]
  edges: GraphLayoutEdgeInput[]
} {
  const nodes: GraphLayoutNodeInput[] = [
    { id: 'agent:self', kind: 'agent' as const, label: 'Self', meta: {} },
    { id: 'agent:peer', kind: 'agent' as const, label: 'Peer', meta: {} }
  ]
  const edges: GraphLayoutEdgeInput[] = []
  for (let i = 0; i < size; i++) {
    const kind = i % 4 === 0 ? 'doc' : 'event'
    const id = `${kind}:private-${i}`
    nodes.push({ id, kind, label: `Private ${i}`, meta: { importance: 'local' } })
    edges.push({
      source: i % 2 === 0 ? 'agent:self' : 'agent:peer',
      target: id,
      kind: 'authored',
      weight: 1,
      meta: {}
    })
  }
  return { nodes, edges }
}

function snapshot(
  nodes: Array<{ id: string; x: number; y: number }>
): Array<{ id: string; x: number; y: number }> {
  return nodes.map((node) => ({ id: node.id, x: node.x, y: node.y }))
}

describe('graph layout settling', () => {
  it('freezes a private graph after a short bounded settling window', () => {
    const graph = privateGraph(96)
    const layout = buildSim(graph.nodes, graph.edges, undefined, () => 0.5)
    const motion = createLayoutMotion({ hasUncachedNodes: true })

    for (let i = 0; i < LAYOUT_ACTIVE_FRAMES + 5; i++) {
      stepSettlingLayout(layout.nodes, layout.edges, motion)
    }

    expect(motion.settled).toBe(true)
    const settledPositions = snapshot(layout.nodes)

    for (let i = 0; i < 10; i++) {
      stepSettlingLayout(layout.nodes, layout.edges, motion)
    }

    expect(snapshot(layout.nodes)).toEqual(settledPositions)
  })

  it('can be warmed after user interaction and then settles again', () => {
    const graph = privateGraph(24)
    const layout = buildSim(graph.nodes, graph.edges, undefined, () => 0.5)
    const motion = createLayoutMotion({ hasUncachedNodes: false })

    for (let i = 0; i < LAYOUT_ACTIVE_FRAMES + 5; i++) {
      stepSettlingLayout(layout.nodes, layout.edges, motion)
    }

    expect(motion.settled).toBe(true)
    warmLayout(motion, 3)
    expect(motion.settled).toBe(false)

    const before = snapshot(layout.nodes)
    stepSettlingLayout(layout.nodes, layout.edges, motion)
    expect(snapshot(layout.nodes)).not.toEqual(before)
  })
})

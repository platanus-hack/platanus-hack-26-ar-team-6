import { describe, expect, it } from 'vitest'

import { AGENT_NETWORK_NODE_ORDER, createAgentNetworkGraph } from '../agentGraph'
import {
  RETRIEVER_ALLOWED_TOOLS,
  UPDATER_ALLOWED_TOOLS,
  USER_AGENT_ALLOWED_TOOLS
} from '../runner'

describe('LangGraph multi-agent runtime', () => {
  it('declares the required multi-agent node order', () => {
    expect(AGENT_NETWORK_NODE_ORDER).toEqual([
      'preflightRetriever',
      'retriever',
      'userAgent',
      'updater'
    ])
  })

  it('keeps role-specific tool permissions explicit', () => {
    expect(USER_AGENT_ALLOWED_TOOLS).toContain('Read')
    expect(USER_AGENT_ALLOWED_TOOLS).toContain('Edit')
    expect(USER_AGENT_ALLOWED_TOOLS).toContain('mcp__relevo-user-retriever__ask_retriever')
    expect(USER_AGENT_ALLOWED_TOOLS).toContain('mcp__relevo-user-retriever__set_activity_title')
    expect(USER_AGENT_ALLOWED_TOOLS).not.toContain('mcp__relevo-memory__agent_ctx')
    expect(USER_AGENT_ALLOWED_TOOLS).not.toContain('mcp__relevo-updater__commit_memory_update')

    expect(RETRIEVER_ALLOWED_TOOLS).toEqual([
      'mcp__relevo-memory__agent_ctx',
      'mcp__relevo-memory__global_ctx'
    ])
    expect(UPDATER_ALLOWED_TOOLS).toEqual([
      'mcp__relevo-updater__commit_memory_update'
    ])
  })

  it('runs retriever before user agent and runs updater on the first checkpoint', async () => {
    // The first checkpoint of a session ignores the elapsed-time gate.
    // Two finalized messages (1 user + 1 assistant) is exactly the
    // CHECKPOINT_MIN_NEW_MESSAGES threshold, so the updater fires.
    const calls: string[] = []
    const graph = createAgentNetworkGraph({
      retrieve: async (request) => {
        calls.push(`retrieve:${request.reason}`)
        return {
          query: request.query,
          scope: 'global',
          results: [],
          insufficient_context: true,
          summary: 'No context.'
        }
      },
      runUserAgent: async (input) => {
        calls.push(`user:${input.preflightContext?.scope ?? 'none'}`)
        return {
          finalAnswer: 'done',
          contextPackets: [],
          activityTitle: 'Greeting Response',
          events: [{ type: 'result', result: 'done' }]
        }
      },
      runUpdater: async () => {
        calls.push('updater')
        return { event_ids: [], document_ids: [] }
      }
    })

    const result = await graph.invoke({
      prompt: 'hello',
      chatSessionId: 'workspace-1',
      conversationMessages: [{ role: 'user', text: 'hello' }]
    })

    expect(calls).toEqual([
      'retrieve:preflight before user-agent turn',
      'user:global',
      'updater'
    ])
    expect(result.finalAnswer).toBe('done')
    expect(result.shouldUpdate).toBe(true)
  })

  it('runs updater on the sixth finalized message', async () => {
    const calls: string[] = []
    const graph = createAgentNetworkGraph({
      retrieve: async (request) => ({
        query: request.query,
        scope: 'global',
        results: [],
        insufficient_context: true,
        summary: 'No context.'
      }),
      runUserAgent: async () => ({
        finalAnswer: 'sixth',
        contextPackets: [],
        events: [{ type: 'result', result: 'sixth' }]
      }),
      runUpdater: async (input) => {
        calls.push(`updater:${input.checkpointIndex}`)
        return { event_ids: ['event-1'], document_ids: ['doc-1'] }
      }
    })

    const result = await graph.invoke({
      prompt: 'finish turn three',
      chatSessionId: 'workspace-1',
      conversationMessages: [
        { role: 'user', text: 'one' },
        { role: 'assistant', text: 'two' },
        { role: 'user', text: 'three' },
        { role: 'assistant', text: 'four' },
        { role: 'user', text: 'five' }
      ]
    })

    expect(calls).toEqual(['updater:0'])
    expect(result.shouldUpdate).toBe(true)
    expect(result.checkpointIndex).toBe(1)
    expect(result.events.at(-1)).toMatchObject({
      type: 'memory_update',
      status: 'succeeded',
      checkpointIndex: 0
    })
  })

  it('first checkpoint of a session ignores the elapsed-time gate', async () => {
    // Two new messages, no prior checkpoint, no elapsed time. Without the
    // first-checkpoint exception this used to silently skip the updater
    // forever, because `conversationStartedAt` resets every fresh graph run.
    const calls: string[] = []
    const graph = createAgentNetworkGraph({
      retrieve: async (request) => ({
        query: request.query,
        scope: 'global',
        results: [],
        insufficient_context: true,
        summary: 'No context.'
      }),
      runUserAgent: async () => ({
        finalAnswer: 'second turn',
        contextPackets: [],
        events: [{ type: 'result', result: 'second turn' }]
      }),
      runUpdater: async (input) => {
        calls.push(`updater:${input.checkpointIndex}`)
        return { event_ids: ['event-1'], document_ids: ['doc-1'] }
      }
    })

    const result = await graph.invoke({
      prompt: 'second',
      chatSessionId: 'workspace-1',
      conversationMessages: [{ role: 'user', text: 'second' }]
    })

    expect(calls).toEqual(['updater:0'])
    expect(result.shouldUpdate).toBe(true)
  })

  it('after a checkpoint, the elapsed-time gate applies', async () => {
    // Once `lastCheckpointAt` is real, two more messages without enough
    // elapsed time must NOT fire the updater again.
    const { shouldRunUpdater, MEMORY_UPDATE_MIN_ELAPSED_MS } = await import(
      '../agentGraph'
    )
    const now = 1_000_000
    const baseState = {
      prompt: '',
      chatSessionId: 's',
      mentionedAgentIds: [],
      conversationMessages: [
        { role: 'user' as const, text: 'a' },
        { role: 'assistant' as const, text: 'b' },
        { role: 'user' as const, text: 'c' },
        { role: 'assistant' as const, text: 'd' }
      ],
      contextPackets: [],
      events: [],
      finalAnswer: '',
      shouldUpdate: false,
      checkpointIndex: 1,
      conversationStartedAt: now - 10_000,
      lastCheckpointAt: now - 5_000,
      lastCheckpointMessageCount: 2,
      preflightRequest: undefined,
      preflightContext: undefined
    }
    expect(shouldRunUpdater(baseState as never, now)).toBe(false)
    expect(
      shouldRunUpdater(
        { ...baseState, lastCheckpointAt: now - MEMORY_UPDATE_MIN_ELAPSED_MS } as never,
        now
      )
    ).toBe(true)
  })
})

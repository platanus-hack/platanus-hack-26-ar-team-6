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

  it('runs retriever before user agent and skips updater below threshold', async () => {
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

    expect(calls).toEqual(['retrieve:preflight before user-agent turn', 'user:global'])
    expect(result.finalAnswer).toBe('done')
    expect(result.shouldUpdate).toBe(false)
    expect(result.events.at(-1)).toMatchObject({
      type: 'activity_title',
      title: 'Greeting Response'
    })
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

    expect(calls).toEqual(['updater:1'])
    expect(result.shouldUpdate).toBe(true)
    expect(result.events.at(-1)).toMatchObject({
      type: 'memory_update',
      status: 'succeeded',
      checkpointIndex: 1
    })
  })
})

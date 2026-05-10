import { describe, expect, it } from 'vitest'

import {
  callAgentContext,
  callGlobalContext,
  commitMemoryUpdate,
  retrieveContext,
  retrieverRequestSchema
} from '../memoryTools'

describe('active multi-agent memory desktop client', () => {
  it('posts agent_ctx with auth headers and normalizes a context packet', async () => {
    const calls: Array<{
      url: string | URL
      method?: string
      headers?: HeadersInit
      body?: string
    }> = []

    const response = await callAgentContext(
      {
        serverUrl: 'https://relevo.example.test/base',
        userId: 'user-1',
        authToken: 'secret-token',
        fetchImpl: async (url, init) => {
          calls.push({
            url,
            method: init?.method,
            headers: init?.headers,
            body: String(init?.body)
          })

          return new Response(
            JSON.stringify({
              context_exchange_id: 'exchange-1',
              insufficient_context: false,
              results: [
                {
                  id: 'entry-1',
                  kind: 'agent_memory_document',
                  content: 'Use Railway for deploys.',
                  metadata: { importance: 'local' },
                  created_at: '2026-05-09T00:00:00Z'
                }
              ]
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        }
      },
      {
        agent_id: 'user-2',
        query: 'How do we deploy?'
      }
    )

    expect(response).toMatchObject({
      query: 'How do we deploy?',
      scope: 'agent',
      target_agent_id: 'user-2',
      context_exchange_id: 'exchange-1',
      insufficient_context: false
    })
    expect(response.results[0].content).toBe('Use Railway for deploys.')
    expect(calls).toHaveLength(1)
    expect(String(calls[0].url)).toBe('https://relevo.example.test/agent-ctx')
    expect(calls[0].method).toBe('POST')
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
      agent_id: 'user-2',
      query: 'How do we deploy?'
    })
    expect(calls[0].headers).toMatchObject({
      'content-type': 'application/json',
      'x-relevo-user-id': 'user-1',
      authorization: 'Bearer secret-token'
    })
  })

  it('posts global_ctx and rejects malformed retriever requests', async () => {
    const response = await callGlobalContext(
      {
        serverUrl: 'http://localhost:8000',
        userId: 'user-1',
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              context_exchange_id: 'exchange-2',
              insufficient_context: true,
              results: []
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
      },
      {
        query: 'shared architecture'
      }
    )

    expect(response.scope).toBe('global')
    expect(response.insufficient_context).toBe(true)
    expect(
      retrieverRequestSchema.safeParse({
        target_agent_id: 'user-2'
      }).success
    ).toBe(false)
  })

  it('posts retriever requests to retrieve-context and strips routing diagnostics', async () => {
    const calls: Array<{ url: string | URL; body?: string }> = []
    const responses = [
      {
        route: { name: 'agent_ctx', target_agent_id: 'user-2' },
        diagnostics: { reason: 'mentioned teammate' },
        context_exchange_id: 'exchange-agent',
        insufficient_context: false,
        results: [
          {
            id: 'entry-agent',
            kind: 'agent_memory_document',
            content: 'Jorf owns Railway deployment.',
            metadata: { importance: 'local' },
            created_at: '2026-05-09T00:00:00Z'
          }
        ]
      },
      {
        route: 'global_ctx',
        diagnostics: { reason: 'shared project question' },
        context_exchange_id: 'exchange-global',
        insufficient_context: true,
        results: []
      }
    ]
    const options = {
      serverUrl: 'http://localhost:8000',
      userId: 'user-1',
      fetchImpl: async (url: string | URL, init?: RequestInit) => {
        calls.push({ url, body: String(init?.body) })
        return new Response(
          JSON.stringify(responses.shift()),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
    }

    const agentPacket = await retrieveContext(options, {
      query: 'What does Jorf own?',
      target_agent_id: 'user-2',
      reason: 'preflight before user-agent turn'
    })
    const globalPacket = await retrieveContext(options, {
      query: 'shared architecture',
      reason: 'preflight before user-agent turn'
    })

    expect(calls.map((call) => new URL(String(call.url)).pathname)).toEqual([
      '/retrieve-context',
      '/retrieve-context'
    ])
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
      query: 'What does Jorf own?',
      target_agent_id: 'user-2',
      reason: 'preflight before user-agent turn'
    })
    expect(JSON.parse(calls[1].body ?? '{}')).toEqual({
      query: 'shared architecture',
      reason: 'preflight before user-agent turn'
    })
    expect(agentPacket).toMatchObject({
      query: 'What does Jorf own?',
      scope: 'agent',
      target_agent_id: 'user-2',
      context_exchange_id: 'exchange-agent',
      insufficient_context: false
    })
    expect(agentPacket.summary).toBe('1. Jorf owns Railway deployment.')
    expect((agentPacket as Record<string, unknown>).route).toBeUndefined()
    expect((agentPacket as Record<string, unknown>).diagnostics).toBeUndefined()
    expect(globalPacket).toMatchObject({
      query: 'shared architecture',
      scope: 'global',
      target_agent_id: undefined,
      context_exchange_id: 'exchange-global',
      insufficient_context: true,
      results: []
    })
  })

  it('commits updater memory operations', async () => {
    const calls: Array<{ body?: string }> = []

    const response = await commitMemoryUpdate(
      {
        serverUrl: 'http://localhost:8000',
        userId: 'user-1',
        fetchImpl: async (_url, init) => {
          calls.push({ body: String(init?.body) })
          return new Response(
            JSON.stringify({
              event_ids: ['event-1'],
              document_ids: ['doc-1']
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        }
      },
      {
        chat_session_id: 'workspace-1',
        checkpoint_index: 1,
        operations: [
          {
            author_agent_id: 'user-1',
            importance: 'local',
            document_key: 'chat-summary',
            event_content: 'A learned deployment context.'
          }
        ]
      }
    )

    expect(response).toEqual({ event_ids: ['event-1'], document_ids: ['doc-1'] })
    expect(JSON.parse(calls[0].body ?? '{}')).toMatchObject({
      chat_session_id: 'workspace-1',
      checkpoint_index: 1
    })
  })

  it('surfaces non-2xx server responses', async () => {
    await expect(
      callGlobalContext(
        {
          serverUrl: 'http://localhost:8000',
          userId: 'user-1',
          fetchImpl: async () =>
            new Response('missing endpoint', {
              status: 404,
              statusText: 'Not Found'
            })
        },
        {
          query: 'Anything deployed?'
        }
      )
    ).rejects.toThrow('global_ctx failed: 404 Not Found: missing endpoint')
  })
})

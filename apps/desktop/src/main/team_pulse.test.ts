import { describe, expect, it, vi } from 'vitest'

import {
  loadTeamPulseRawEvents,
  loadResponsibilities,
  loadTeamPulse,
  refreshTeamPulse,
  type TeamPulseRawEvent,
  type TeamPulseResponse,
  type ResponsibilitiesResponse,
} from '../teamPulse'

type FetchCall = {
  url: string
  method?: string
  body?: unknown
}

function setupFetchSequence(responses: Array<{ status?: number; body: unknown }>): {
  calls: FetchCall[]
  restore: () => void
} {
  const calls: FetchCall[] = []
  const original = global.fetch
  let index = 0
  ;(global as { fetch: typeof fetch }).fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({
      url,
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    const next = responses[index++]
    if (!next) {
      throw new Error(`unexpected fetch: ${url}`)
    }
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return {
    calls,
    restore: () => {
      ;(global as { fetch: typeof fetch }).fetch = original
    },
  }
}

describe('teamPulse loadTeamPulse', () => {
  it('builds the GET URL with bucket params and forwards bearer auth', async () => {
    const grid: TeamPulseResponse = {
      bucket_size_seconds: 3600,
      bucket_starts: ['2026-05-09T13:00:00Z'],
      members: [],
    }
    const { calls, restore } = setupFetchSequence([{ body: grid }])
    try {
      const result = await loadTeamPulse({
        serverBaseUrl: 'https://api.example.com/',
        sessionToken: 'tok',
        projectId: 'proj-1',
        selfAgentId: 'agent-1',
        bucketSize: 3600,
        bucketCount: 4,
      })
      expect(result).toEqual(grid)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.url).toBe(
        'https://api.example.com/projects/proj-1/team-pulse?size=3600&buckets=4',
      )
    } finally {
      restore()
    }
  })
})

describe('teamPulse loadTeamPulseRawEvents', () => {
  it('builds the raw events URL with agent and window filters', async () => {
    const events: TeamPulseRawEvent[] = [
      {
        id: 'event-1',
        agent_id: 'agent-1',
        bucket_start: '2026-05-09T13:00:00Z',
        content: 'Checkpoint 1:\n\nUSER: wired oauth callback',
        metadata: { source: 'claude_code_hook' },
        created_at: '2026-05-09T13:17:00Z',
      },
    ]
    const { calls, restore } = setupFetchSequence([{ body: { events } }])
    try {
      const result = await loadTeamPulseRawEvents(
        {
          serverBaseUrl: 'https://api.example.com/',
          sessionToken: 'tok',
          projectId: 'proj-1',
          selfAgentId: 'agent-1',
          bucketSize: 3600,
          bucketCount: 4,
        },
        {
          agentId: 'agent-1',
          since: '2026-05-09T00:00:00.000Z',
          until: '2026-05-10T00:00:00.000Z',
        },
      )

      expect(result).toEqual(events)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.url).toBe(
        'https://api.example.com/projects/proj-1/team-pulse/raw-events?size=3600&buckets=4&agent_id=agent-1&since=2026-05-09T00%3A00%3A00.000Z&until=2026-05-10T00%3A00%3A00.000Z',
      )
    } finally {
      restore()
    }
  })
})

describe('teamPulse refreshTeamPulse', () => {
  it('summarises buckets without LLM when key is missing and posts results', async () => {
    const grid: TeamPulseResponse = {
      bucket_size_seconds: 3600,
      bucket_starts: ['2026-05-09T13:00:00Z'],
      members: [
        {
          agent_id: 'agent-1',
          display_name: 'Asker',
          cells: [{ summary: null, event_count: 0 }],
        },
      ],
    }
    const events: TeamPulseRawEvent[] = [
      {
        id: 'event-1',
        agent_id: 'agent-1',
        bucket_start: '2026-05-09T13:00:00Z',
        content: 'Checkpoint 1:\n\nUSER: wired oauth callback to fastapi handler',
        metadata: { source: 'claude_code_hook' },
        created_at: '2026-05-09T13:17:00Z',
      },
    ]
    const { calls, restore } = setupFetchSequence([
      { body: grid },
      { body: { events } },
      { body: { events } },
      {
        body: {
          pulse_doc_ids: ['pulse-1'],
          responsibility_doc_ids: ['resp-1'],
        },
      },
    ])

    try {
      const result = await refreshTeamPulse({
        serverBaseUrl: 'https://api.example.com',
        sessionToken: 'tok',
        projectId: 'proj-1',
        selfAgentId: 'agent-1',
        anthropicApiKey: null,
        bucketSize: 3600,
        bucketCount: 1,
      })
      expect(result.pulse_doc_ids).toEqual(['pulse-1'])

      expect(calls).toHaveLength(4)
      expect(calls[3]?.url).toBe('https://api.example.com/projects/proj-1/team-pulse/refresh')
      const refreshBody = calls[3]?.body as {
        size: number
        buckets: number
        summaries: Array<{
          agent_id: string
          bucket_start: string
          summary: string
          event_count: number
        }>
        responsibilities: Array<{
          agent_id: string
          content: string
          word_count: number
        }>
      }
      expect(refreshBody.size).toBe(3600)
      expect(refreshBody.summaries).toHaveLength(1)
      expect(refreshBody.summaries[0]?.summary).toBe('wired oauth callback to fastapi handler')
      expect(refreshBody.summaries[0]?.event_count).toBe(1)
      expect(refreshBody.responsibilities).toHaveLength(1)
      expect(refreshBody.responsibilities[0]?.agent_id).toBe('agent-1')
      expect(refreshBody.responsibilities[0]?.word_count).toBeGreaterThan(0)
    } finally {
      restore()
    }
  })

  it('scans each member from their last checkpoint and rebuilds the open bucket', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-09T15:30:00Z'))

    const grid: TeamPulseResponse = {
      bucket_size_seconds: 3600,
      bucket_starts: ['2026-05-09T13:00:00Z', '2026-05-09T14:00:00Z', '2026-05-09T15:00:00Z'],
      members: [
        {
          agent_id: 'agent-1',
          display_name: 'Asker',
          cells: [
            { summary: 'handled auth', event_count: 1 },
            { summary: 'wired callbacks', event_count: 1 },
            { summary: null, event_count: 0 },
          ],
        },
        {
          agent_id: 'agent-2',
          display_name: 'Teammate',
          cells: [
            { summary: null, event_count: 0 },
            { summary: 'reviewed deployment', event_count: 1 },
            { summary: 'existing bucket checkpoint', event_count: 1 },
          ],
        },
      ],
    }
    const events: TeamPulseRawEvent[] = [
      {
        id: 'ignored-old-event',
        agent_id: 'agent-1',
        bucket_start: '2026-05-09T14:00:00Z',
        content: 'Checkpoint 2:\n\nUSER: old prompt that is already scanned',
        metadata: { source: 'claude_code_hook' },
        created_at: '2026-05-09T14:10:00Z',
      },
      {
        id: 'event-1',
        agent_id: 'agent-1',
        bucket_start: '2026-05-09T15:00:00Z',
        content: 'Checkpoint 3:\n\nUSER: implemented hourly checkpoints',
        metadata: { source: 'claude_code_hook' },
        created_at: '2026-05-09T15:08:00Z',
      },
      {
        id: 'event-2',
        agent_id: 'agent-2',
        bucket_start: '2026-05-09T15:00:00Z',
        content: 'Checkpoint 4:\n\nUSER: debugged refresh routing',
        metadata: { source: 'claude_code_hook' },
        created_at: '2026-05-09T15:12:00Z',
      },
    ]
    const { calls, restore } = setupFetchSequence([
      { body: grid },
      { body: { events } },
      { body: { events: [events[1]] } },
      {
        body: {
          pulse_doc_ids: ['pulse-1', 'pulse-2'],
          responsibility_doc_ids: ['resp-1'],
        },
      },
    ])

    try {
      await refreshTeamPulse({
        serverBaseUrl: 'https://api.example.com',
        sessionToken: 'tok',
        projectId: 'proj-1',
        selfAgentId: 'agent-1',
        anthropicApiKey: null,
        bucketSize: 3600,
        bucketCount: 3,
      })

      const refreshBody = calls[3]?.body as {
        summaries: Array<{
          agent_id: string
          bucket_start: string
          summary: string
          event_ids: string[]
        }>
      }
      expect(refreshBody.summaries).toHaveLength(2)
      expect(refreshBody.summaries.map((summary) => summary.agent_id)).toEqual([
        'agent-1',
        'agent-2',
      ])
      expect(refreshBody.summaries[0]?.bucket_start).toBe('2026-05-09T15:00:00Z')
      expect(refreshBody.summaries[0]?.event_ids).toEqual(['event-1'])
      expect(refreshBody.summaries[1]?.summary).toContain('existing bucket checkpoint')
      expect(refreshBody.summaries[1]?.event_ids).toEqual(['event-2'])
    } finally {
      restore()
      vi.useRealTimers()
    }
  })

  it('skips POST when there are no summaries and no responsibility doc to write', async () => {
    // Setup: closed bucket already filled, no new events to summarise, AND
    // no events at all in the 30-day window AND no previous responsibility
    // doc -> generateResponsibilityDoc returns null -> nothing to send.
    const grid: TeamPulseResponse = {
      bucket_size_seconds: 3600,
      bucket_starts: ['2026-05-09T08:00:00Z'],
      members: [
        {
          agent_id: 'agent-1',
          display_name: 'Asker',
          cells: [{ summary: 'already cached', event_count: 1 }],
        },
      ],
    }
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-09T13:30:00Z'))

    const { calls, restore } = setupFetchSequence([
      { body: grid },
      { body: { events: [] } },
      { body: { events: [] } },
    ])
    try {
      const result = await refreshTeamPulse({
        serverBaseUrl: 'https://api.example.com',
        sessionToken: 'tok',
        projectId: 'proj-1',
        selfAgentId: 'agent-1',
        anthropicApiKey: null,
        bucketSize: 3600,
        bucketCount: 1,
      })
      // exactly 3 calls: GET grid, GET timeline raw-events, GET responsibility raw-events. No POST.
      expect(calls).toHaveLength(3)
      expect(result.pulse_doc_ids).toEqual([])
      expect(result.responsibility_doc_ids).toEqual([])
    } finally {
      restore()
      vi.useRealTimers()
    }
  })
})

describe('teamPulse loadResponsibilities', () => {
  it('hits /responsibilities and returns the response', async () => {
    const responsibilities: ResponsibilitiesResponse = {
      members: [
        {
          agent_id: 'agent-1',
          display_name: 'Asker',
          content: 'doc body',
          updated_at: '2026-05-09T13:00:00Z',
          word_count: 3,
        },
      ],
    }
    const { calls, restore } = setupFetchSequence([{ body: responsibilities }])
    try {
      const result = await loadResponsibilities({
        serverBaseUrl: 'https://api.example.com',
        sessionToken: 'tok',
        projectId: 'proj-1',
      })
      expect(result).toEqual(responsibilities)
      expect(calls[0]?.url).toBe('https://api.example.com/projects/proj-1/responsibilities')
    } finally {
      restore()
    }
  })
})

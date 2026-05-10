import { describe, expect, it, vi } from 'vitest'

import {
  hydrateRailwaywiseDemoLocalData,
  isMissingRailwaywiseDemoEndpointError,
  resolveRailwaywiseProjectId
} from './demoRailwaywise'

function createStorage(seed: Record<string, string | null> = {}): {
  values: Map<string, string>
  storage: Storage
} {
  const values = new Map(Object.entries(seed).flatMap(([key, value]) => (value === null ? [] : [[key, value]])))
  return {
    values,
    storage: {
      get length() {
        return values.size
      },
      clear: vi.fn(() => values.clear()),
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
      removeItem: vi.fn((key: string) => {
        values.delete(key)
      }),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value)
      })
    }
  }
}

describe('Railwaywise demo local hydration', () => {
  it('writes demo tasks with real roster IDs and display names', async () => {
    const { values, storage } = createStorage()
    const loadConversation = vi.fn(async () => ({ sessionId: null, messages: [] }))
    const saveConversation = vi.fn(async () => undefined)

    const result = await hydrateRailwaywiseDemoLocalData({
      projectId: 'project-rw',
      roster: [
        {
          id: 'agent-data',
          display_name: 'Dana Data',
          domain_summary: 'Data and analytics owner'
        },
        {
          id: 'agent-ops',
          display_name: 'Olivia Ops',
          domain_summary: 'Operations dispatcher workflow'
        },
        {
          id: 'agent-ui',
          display_name: 'Uma UI',
          domain_summary: 'Frontend product design'
        }
      ],
      storage,
      conversationStore: { loadConversation, saveConversation }
    })

    expect(result).toEqual({
      tasksWritten: true,
      historyWritten: true,
      activeConversationWritten: true
    })

    const tasks = JSON.parse(values.get('relevo:tasks:v3:project-rw') ?? '{}') as {
      approved: Array<{ ownerId: string; ownerDisplayName: string }>
    }
    expect(tasks.approved).toHaveLength(17)
    expect(tasks.approved[0]).toMatchObject({
      ownerId: 'agent-data',
      ownerDisplayName: 'Dana Data'
    })
    expect(tasks.approved[1]).toMatchObject({
      ownerId: 'agent-ops',
      ownerDisplayName: 'Olivia Ops'
    })
    expect(tasks.approved[3]).toMatchObject({
      ownerId: 'agent-ui',
      ownerDisplayName: 'Uma UI'
    })

    const history = JSON.parse(values.get('omni:chat-history:project-rw') ?? '[]') as unknown[]
    expect(history).toHaveLength(3)
    expect(saveConversation).toHaveBeenCalledWith('project-rw', {
      sessionId: 'railwaywise-demo-active',
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          text: expect.stringContaining('@Dana Data')
        })
      ])
    })
  })

  it('skips existing localStorage keys and active conversation data', async () => {
    const { values, storage } = createStorage({
      'relevo:tasks:v3:project-rw': JSON.stringify({ approved: [{ id: 'user-task' }] }),
      'omni:chat-history:project-rw': JSON.stringify([{ id: 'user-chat' }])
    })
    const existingConversation = {
      sessionId: 'user-session',
      messages: [{ id: 'message-1', role: 'user' as const, text: 'keep this' }]
    }
    const loadConversation = vi.fn(async () => existingConversation)
    const saveConversation = vi.fn(async () => undefined)

    const result = await hydrateRailwaywiseDemoLocalData({
      projectId: 'project-rw',
      roster: [{ id: 'agent-1', display_name: 'Real Person', domain_summary: 'Ops' }],
      storage,
      conversationStore: { loadConversation, saveConversation }
    })

    expect(result).toEqual({
      tasksWritten: false,
      historyWritten: false,
      activeConversationWritten: false
    })
    expect(JSON.parse(values.get('relevo:tasks:v3:project-rw') ?? '{}')).toEqual({
      approved: [{ id: 'user-task' }]
    })
    expect(JSON.parse(values.get('omni:chat-history:project-rw') ?? '[]')).toEqual([{ id: 'user-chat' }])
    expect(saveConversation).not.toHaveBeenCalled()
  })
})

describe('resolveRailwaywiseProjectId', () => {
  it('prefers a valid project id returned by the endpoint', () => {
    expect(
      resolveRailwaywiseProjectId(
        { project_id: 'project-rw' },
        [
          { project_id: 'project-other', project_name: 'Other' },
          { project_id: 'project-rw', project_name: 'Railwaywise demo' }
        ]
      )
    ).toBe('project-rw')
  })

  it('falls back to the refreshed Railwaywise project name', () => {
    expect(
      resolveRailwaywiseProjectId(
        {},
        [
          { project_id: 'project-other', project_name: 'Other' },
          { project_id: 'project-rw', project_name: 'Railwaywise workspace' }
        ]
      )
    ).toBe('project-rw')
  })
})

describe('isMissingRailwaywiseDemoEndpointError', () => {
  it('detects old servers that do not expose the Railwaywise demo endpoint', () => {
    expect(
      isMissingRailwaywiseDemoEndpointError(
        new Error('404 Not Found: {"detail":"Not Found"}')
      )
    ).toBe(true)
  })

  it('does not hide non-404 failures', () => {
    expect(isMissingRailwaywiseDemoEndpointError(new Error('401 Unauthorized'))).toBe(false)
    expect(isMissingRailwaywiseDemoEndpointError(new Error('500 Internal Server Error'))).toBe(false)
  })
})

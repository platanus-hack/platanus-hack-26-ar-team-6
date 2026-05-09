import { afterEach, describe, expect, it, vi } from 'vitest'

import { ServerClient } from './server_client'

describe('ServerClient requestContext', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts the canonical request-context payload and returns the structured response', async () => {
    const serverResponse = {
      answer: 'User2 says check /health before deploy.',
      source_user_ids: ['user-2'],
      target_user_id: 'user-2',
      context_entry_id: 'cross-user-qa-entry',
      source_context_entry_ids: ['seed-entry-1'],
      retrieved_context_entries: [
        {
          id: 'seed-entry-1',
          kind: 'prompt_answer',
          content: 'Check /health before deploy.',
          metadata: { source: 'seed' },
          created_at: '2026-05-09T12:00:00Z'
        }
      ]
    }
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify(serverResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new ServerClient({
      baseUrl: 'http://localhost:8000///',
      authToken: 'dev-token-user1'
    })

    const result = await client.requestContext({
      target_user_id: 'user-2',
      question: 'What deploy quirks should I know about?'
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/request-context', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer dev-token-user1',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        target_user_id: 'user-2',
        question: 'What deploy quirks should I know about?'
      })
    })
    expect(result).toEqual(serverResponse)
  })
})

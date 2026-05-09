import { describe, expect, it } from 'vitest'

import { callRequestContext, requestContextInputSchema } from '../requestContextTool'

describe('active request_context desktop client', () => {
  it('posts the server request-context contract with auth headers', async () => {
    const calls: Array<{
      url: string | URL
      method?: string
      headers?: HeadersInit
      body?: string
    }> = []

    const response = await callRequestContext(
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
              answer: 'Use Railway for deploys.',
              source_user_ids: ['user-2'],
              citations: [{ claim: 'Railway deploys.', context_entry_id: 'entry-1' }]
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        }
      },
      {
        target: 'user-2',
        question: 'How do we deploy?'
      }
    )

    expect(response).toEqual({
      answer: 'Use Railway for deploys.',
      source_user_ids: ['user-2'],
      citations: [{ claim: 'Railway deploys.', context_entry_id: 'entry-1' }]
    })
    expect(calls).toHaveLength(1)
    expect(String(calls[0].url)).toBe('https://relevo.example.test/request-context')
    expect(calls[0].method).toBe('POST')
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
      target: 'user-2',
      question: 'How do we deploy?'
    })
    expect(calls[0].headers).toMatchObject({
      'content-type': 'application/json',
      'x-relevo-user-id': 'user-1',
      authorization: 'Bearer secret-token'
    })
  })

  it('supports project target without auth and rejects multi-target input', async () => {
    const calls: Array<{ headers?: HeadersInit; body?: string }> = []

    await callRequestContext(
      {
        serverUrl: 'http://localhost:8000',
        userId: 'user-1',
        fetchImpl: async (_url, init) => {
          calls.push({
            headers: init?.headers,
            body: String(init?.body)
          })

          return new Response(
            JSON.stringify({
              answer: 'Project context says use the shared server.',
              source_user_ids: []
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        }
      },
      {
        target: 'project',
        question: 'What shared architecture exists?'
      }
    )

    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
      target: 'project',
      question: 'What shared architecture exists?'
    })
    expect(calls[0].headers).not.toHaveProperty('authorization')
    expect(
      requestContextInputSchema.safeParse({
        target: ['user-2', 'project'],
        question: 'Unsupported multi-target request'
      }).success
    ).toBe(false)
  })

  it('surfaces non-2xx server responses', async () => {
    await expect(
      callRequestContext(
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
          target: 'project',
          question: 'Anything deployed?'
        }
      )
    ).rejects.toThrow('request_context failed: 404 Not Found: missing endpoint')
  })
})

import { describe, expect, it } from 'vitest'

import {
  REQUEST_CONTEXT_TOOL_NAME,
  createRequestContextSdkTool
} from './request_context'
import type { ServerClient } from '../server_client'

describe('request_context SDK tool', () => {
  it('brokers tool calls to the server and returns structured content', async () => {
    const calls: unknown[] = []
    const client = {
      async requestContext(req: unknown) {
        calls.push(req)
        return {
          answer: 'Ask User2 before changing the deploy healthcheck.',
          source_user_ids: ['user-2']
        }
      }
    } as ServerClient

    const sdkTool = createRequestContextSdkTool(client)
    const result = await sdkTool.handler(
      {
        target: 'user-2',
        question: 'What deploy quirks should I know about?'
      },
      {}
    )

    expect(sdkTool.name).toBe(REQUEST_CONTEXT_TOOL_NAME)
    expect(calls).toEqual([
      {
        target_user_id: 'user-2',
        question: 'What deploy quirks should I know about?'
      }
    ])
    expect(result.structuredContent).toEqual({
      answer: 'Ask User2 before changing the deploy healthcheck.',
      source_user_ids: ['user-2']
    })
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          answer: 'Ask User2 before changing the deploy healthcheck.',
          source_user_ids: ['user-2']
        })
      }
    ])
  })

  it('returns tool errors as data so the agent loop can continue', async () => {
    const client = {
      async requestContext() {
        throw new Error('server unavailable')
      }
    } as unknown as ServerClient

    const result = await createRequestContextSdkTool(client).handler(
      {
        target: 'user-2',
        question: 'What deploy quirks should I know about?'
      },
      {}
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]).toEqual({
      type: 'text',
      text: JSON.stringify({ error: 'server unavailable' })
    })
  })
})

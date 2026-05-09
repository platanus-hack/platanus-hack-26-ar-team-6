import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

import type { RequestContextResponse, ServerClient } from '../server_client'

export const REQUEST_CONTEXT_SERVER_NAME = 'relevo'
export const REQUEST_CONTEXT_TOOL_NAME = 'request_context'
export const REQUEST_CONTEXT_ALLOWED_TOOL = `mcp__${REQUEST_CONTEXT_SERVER_NAME}__${REQUEST_CONTEXT_TOOL_NAME}`

const requestContextInputSchema = {
  target: z
    .string()
    .min(1)
    .describe(
      'user_id (UUID) of the teammate whose context to query. Must be one of the user_ids from the roster.'
    ),
  question: z.string().min(1).describe("Free-form natural-language question to ask the teammate's AI.")
}

export const requestContextTool = {
  name: REQUEST_CONTEXT_TOOL_NAME,
  description:
    "Ask a teammate's AI for context the local AI does not have. Use when the user's question requires knowledge owned by another teammate (per the roster loaded at session start). The teammate's AI will answer using their stored context, and the Q&A will be persisted to the teammate's context for future retrieval.",
  input_schema: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description:
          'user_id (UUID) of the teammate whose context to query. Must be one of the user_ids from the roster.'
      },
      question: {
        type: 'string',
        description: "Free-form natural-language question to ask the teammate's AI."
      }
    },
    required: ['target', 'question']
  }
} as const

export type RequestContextInput = {
  target: string
  question: string
}

function createMinimalToolResult(response: RequestContextResponse): Pick<
  RequestContextResponse,
  'answer' | 'source_user_ids'
> {
  return {
    answer: response.answer,
    source_user_ids: response.source_user_ids
  }
}

export function createRequestContextSdkTool(
  client: ServerClient
): SdkMcpToolDefinition<typeof requestContextInputSchema> {
  return tool(
    requestContextTool.name,
    requestContextTool.description,
    requestContextInputSchema,
    async (input) => {
      try {
        const response = await client.requestContext({
          target_user_id: input.target,
          question: input.question
        })
        const text = JSON.stringify(createMinimalToolResult(response))
        return {
          content: [{ type: 'text' as const, text }],
          structuredContent: response
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
          isError: true
        }
      }
    },
    {
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      },
      alwaysLoad: true
    }
  )
}

export function createRequestContextHandler(
  client: ServerClient
): (input: RequestContextInput) => Promise<string> {
  return async (input) => {
    try {
      const response = await client.requestContext({
        target_user_id: input.target,
        question: input.question
      })
      return JSON.stringify(createMinimalToolResult(response))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return JSON.stringify({ error: message })
    }
  }
}

import {
  createSdkMcpServer,
  query,
  type Options,
  type SDKMessage
} from '@anthropic-ai/claude-agent-sdk'

import { ServerClient } from './server_client'
import {
  REQUEST_CONTEXT_ALLOWED_TOOL,
  REQUEST_CONTEXT_SERVER_NAME,
  createRequestContextSdkTool
} from './tools/request_context'

export type LocalRunnerConfig = {
  apiBaseUrl: string
  authToken: string
  cwd: string
  maxTurns?: number
  model?: string
  systemPrompt?: Options['systemPrompt']
}

export type LocalRunnerPromptRequest = LocalRunnerConfig & {
  prompt: string
}

export type LocalRunnerPromptResponse = {
  result: string
  messages: SDKMessage[]
}

function requireNonEmpty(value: string, name: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${name} is required`)
  }
  return trimmed
}

export function createLocalRunnerOptions(config: LocalRunnerConfig): Options {
  const client = new ServerClient({
    baseUrl: requireNonEmpty(config.apiBaseUrl, 'apiBaseUrl'),
    authToken: requireNonEmpty(config.authToken, 'authToken')
  })
  const requestContextServer = createSdkMcpServer({
    name: REQUEST_CONTEXT_SERVER_NAME,
    version: '0.0.0',
    tools: [createRequestContextSdkTool(client)]
  })

  return {
    cwd: requireNonEmpty(config.cwd, 'cwd'),
    ...(config.maxTurns === undefined ? {} : { maxTurns: config.maxTurns }),
    ...(config.model === undefined ? {} : { model: config.model }),
    systemPrompt: config.systemPrompt ?? {
      type: 'preset',
      preset: 'claude_code',
      append:
        'Use the request_context tool when another teammate is the right source for missing project context.'
    },
    mcpServers: {
      [REQUEST_CONTEXT_SERVER_NAME]: requestContextServer
    },
    allowedTools: [REQUEST_CONTEXT_ALLOWED_TOOL]
  }
}

export async function runLocalAgentPrompt(
  request: LocalRunnerPromptRequest
): Promise<LocalRunnerPromptResponse> {
  const messages: SDKMessage[] = []
  let result = ''

  for await (const message of query({
    prompt: requireNonEmpty(request.prompt, 'prompt'),
    options: createLocalRunnerOptions(request)
  })) {
    messages.push(message)
    if (message.type === 'result') {
      if (message.subtype === 'success') {
        result = message.result
      } else {
        throw new Error(message.errors.join('\n'))
      }
    }
  }

  return { result, messages }
}

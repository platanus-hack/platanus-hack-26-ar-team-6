import { describe, expect, it } from 'vitest'

import { REQUEST_CONTEXT_ALLOWED_TOOL } from './tools/request_context'
import { createLocalRunnerOptions } from './local_runner'

describe('local runner registration', () => {
  it('registers request_context as an allowed in-process MCP tool', () => {
    const options = createLocalRunnerOptions({
      apiBaseUrl: 'http://localhost:8000/',
      authToken: 'dev-token-user1',
      cwd: '/workspace/project'
    })

    expect(options.cwd).toBe('/workspace/project')
    expect(options.mcpServers).toHaveProperty('relevo')
    expect(options.allowedTools).toContain(REQUEST_CONTEXT_ALLOWED_TOOL)
  })
})

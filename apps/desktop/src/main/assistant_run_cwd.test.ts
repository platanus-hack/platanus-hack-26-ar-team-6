import { describe, expect, it } from 'vitest'

import { resolveAssistantRunCwd } from './assistantRunCwd'

describe('assistant run working directory', () => {
  it('uses the selected project folder from persisted settings', () => {
    expect(resolveAssistantRunCwd('/Users/example/project')).toBe('/Users/example/project')
  })

  it('requires a selected project folder before starting the local assistant', () => {
    expect(() => resolveAssistantRunCwd(null)).toThrow('Connect a project folder before running assistant.')
    expect(() => resolveAssistantRunCwd('   ')).toThrow('Connect a project folder before running assistant.')
  })
})

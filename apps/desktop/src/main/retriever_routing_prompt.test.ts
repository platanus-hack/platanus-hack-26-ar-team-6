import { describe, expect, it } from 'vitest'

import { buildRetrieverPrompt } from '../runner'

describe('retriever prompt: responsibility-doc routing fallback', () => {
  it('teaches the retriever to follow up on responsibility_doc owners', () => {
    const prompt = buildRetrieverPrompt('asker-id', {
      query: 'who owns the OAuth flow?'
    })

    expect(prompt).toContain('Call global_ctx with query="who owns the OAuth flow?"')
    expect(prompt).toContain('responsibility_doc')
    expect(prompt).toContain('agent_ctx(agent_id=')
    expect(prompt).toContain('insufficient_context=true')
    expect(prompt).toContain('Never call agent_ctx more than once per turn')
  })

  it('still routes targeted retrievals straight to agent_ctx', () => {
    const prompt = buildRetrieverPrompt('asker-id', {
      query: 'how does the deploy work?',
      target_agent_id: 'teammate-id'
    })

    expect(prompt).toContain('Call agent_ctx with agent_id="teammate-id"')
    // The fallback section is still present so the retriever can reason
    // about combined results, but the primary instruction is direct.
    expect(prompt).toContain('responsibility_doc')
  })
})

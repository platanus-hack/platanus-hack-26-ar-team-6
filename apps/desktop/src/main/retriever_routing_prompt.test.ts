import { describe, expect, it } from 'vitest'

import * as runner from '../runner'
import { RETRIEVAL_CLIENT_ALLOWED_TOOLS } from '../runner'

describe('retrieval client routing', () => {
  it('keeps the old retriever-agent prompt out of the runtime', () => {
    expect('buildRetrieverPrompt' in runner).toBe(false)
    expect(RETRIEVAL_CLIENT_ALLOWED_TOOLS).toEqual([])
  })
})

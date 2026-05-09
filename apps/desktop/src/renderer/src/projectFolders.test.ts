import { describe, expect, it } from 'vitest'

import { getProjectFolderDisplayName, hasConnectedProjectFolder } from './projectFolders'

describe('project folder UI helpers', () => {
  it('uses the final path segment as the folder display name', () => {
    expect(getProjectFolderDisplayName('/Users/example/work/demo-app')).toBe('demo-app')
    expect(getProjectFolderDisplayName('C:\\Users\\example\\work\\demo-app\\')).toBe('demo-app')
  })

  it('marks empty project folder values as disconnected', () => {
    expect(hasConnectedProjectFolder('/tmp/project')).toBe(true)
    expect(hasConnectedProjectFolder(null)).toBe(false)
    expect(hasConnectedProjectFolder('   ')).toBe(false)
  })
})

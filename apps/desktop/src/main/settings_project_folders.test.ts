import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  userDataPath: ''
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronMock.userDataPath)
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((value: string) => Buffer.from(value, 'utf-8')),
    decryptString: vi.fn((value: Buffer) => value.toString('utf-8'))
  }
}))

import {
  clearProjectFolder,
  clearRelevoSession,
  getDesktopSettings,
  saveProjectFolder,
  saveRelevoAuthState,
  saveRelevoSession,
  saveSelectedProjectId,
  type DesktopAccountSummary,
  type DesktopProjectMembership
} from './settings'

const DEFAULT_SERVER_BASE_URL = 'http://localhost:8000'
const PROJECT_ID = 'project-1'
const OTHER_PROJECT_ID = 'project-2'

const account: DesktopAccountSummary = {
  id: 'account-1',
  email: 'user@example.com',
  display_name: 'User Example',
  email_verified: true
}

function membership(projectId = PROJECT_ID, projectName = 'Demo Project'): DesktopProjectMembership {
  return {
    project_id: projectId,
    project_name: projectName,
    description: null,
    user_id: `user-${projectId}`,
    display_name: 'User Example',
    domain_summary: 'Owns the demo.',
    role: 'leader'
  }
}

async function seedSession(projects = [membership()]): Promise<void> {
  await saveRelevoSession(
    {
      sessionToken: 'rlv_test',
      account,
      projects
    },
    DEFAULT_SERVER_BASE_URL
  )
  await saveSelectedProjectId(projects[0].project_id, DEFAULT_SERVER_BASE_URL)
}

describe('desktop project folder settings', () => {
  let tempRoot: string

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'relevo-settings-'))
    electronMock.userDataPath = join(tempRoot, 'user-data')
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('saves an existing directory for a valid project and exposes it for the selected project', async () => {
    await seedSession()
    const projectFolder = await mkdtemp(join(tempRoot, 'project-folder-'))

    const settings = await saveProjectFolder(PROJECT_ID, projectFolder, DEFAULT_SERVER_BASE_URL)

    expect(settings.projectFolders).toEqual({ [PROJECT_ID]: projectFolder })
    expect(settings.selectedProjectFolderPath).toBe(projectFolder)
  })

  it('rejects folder saves for projects outside the current account project list', async () => {
    await seedSession()
    const projectFolder = await mkdtemp(join(tempRoot, 'project-folder-'))

    await expect(saveProjectFolder('missing-project', projectFolder, DEFAULT_SERVER_BASE_URL)).rejects.toThrow(
      'Project folder can only be set for a current account project.'
    )
  })

  it('rejects files and missing paths as project folders', async () => {
    await seedSession()
    const filePath = join(tempRoot, 'not-a-folder.txt')
    await writeFile(filePath, 'not a directory', 'utf-8')

    await expect(saveProjectFolder(PROJECT_ID, filePath, DEFAULT_SERVER_BASE_URL)).rejects.toThrow(
      'Project folder must be a directory'
    )
    await expect(saveProjectFolder(PROJECT_ID, join(tempRoot, 'missing'), DEFAULT_SERVER_BASE_URL)).rejects.toThrow(
      'Project folder must be an existing directory'
    )
  })

  it('removes stale project folder mappings when projects refresh', async () => {
    await seedSession([membership(PROJECT_ID), membership(OTHER_PROJECT_ID, 'Other Project')])
    const projectFolder = await mkdtemp(join(tempRoot, 'project-folder-'))
    const staleProjectFolder = await mkdtemp(join(tempRoot, 'stale-project-folder-'))
    await saveProjectFolder(PROJECT_ID, projectFolder, DEFAULT_SERVER_BASE_URL)
    await saveProjectFolder(OTHER_PROJECT_ID, staleProjectFolder, DEFAULT_SERVER_BASE_URL)

    const settings = await saveRelevoAuthState(
      {
        account,
        projects: [membership(PROJECT_ID)]
      },
      DEFAULT_SERVER_BASE_URL
    )

    expect(settings.projectFolders).toEqual({ [PROJECT_ID]: projectFolder })
  })

  it('clears project folder mappings on logout', async () => {
    await seedSession()
    const projectFolder = await mkdtemp(join(tempRoot, 'project-folder-'))
    await saveProjectFolder(PROJECT_ID, projectFolder, DEFAULT_SERVER_BASE_URL)

    const settings = await clearRelevoSession(DEFAULT_SERVER_BASE_URL)

    expect(settings.projectFolders).toEqual({})
    expect(settings.selectedProjectFolderPath).toBeNull()
  })

  it('clears a saved folder for a single current project', async () => {
    await seedSession()
    const projectFolder = await mkdtemp(join(tempRoot, 'project-folder-'))
    await saveProjectFolder(PROJECT_ID, projectFolder, DEFAULT_SERVER_BASE_URL)

    const settings = await clearProjectFolder(PROJECT_ID, DEFAULT_SERVER_BASE_URL)

    expect(settings.projectFolders).toEqual({})
    expect(settings.selectedProjectFolderPath).toBeNull()
    await expect(getDesktopSettings(DEFAULT_SERVER_BASE_URL)).resolves.toMatchObject({
      projectFolders: {},
      selectedProjectFolderPath: null
    })
  })
})

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  setClaudeCodeHooksEnabled,
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

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf-8')) as T
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
    expect(settings.claudeCodeHooksEnabled).toBe(true)
    expect(settings.selectedProjectClaudeHook.active).toBe(true)
  })

  it('installs the Claude Code hook and stores hook credentials outside the project folder', async () => {
    await seedSession()
    const projectFolder = await mkdtemp(join(tempRoot, 'project-folder-'))

    await saveProjectFolder(PROJECT_ID, projectFolder, DEFAULT_SERVER_BASE_URL)

    const claudeSettingsRaw = await readFile(join(projectFolder, '.claude', 'settings.json'), 'utf-8')
    const claudeSettings = JSON.parse(claudeSettingsRaw) as {
      hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string }> }>>
    }
    const promptCommand = claudeSettings.hooks.UserPromptSubmit.at(-1)?.hooks[0]?.command
    const stopCommand = claudeSettings.hooks.Stop.at(-1)?.hooks[0]?.command
    expect(promptCommand).toContain('.claude/hooks/relevo_activity.py')
    expect(stopCommand).toBe(promptCommand)
    expect(claudeSettingsRaw).not.toContain('rlv_test')

    const hookScript = await readFile(join(projectFolder, '.claude', 'hooks', 'relevo_activity.py'), 'utf-8')
    expect(hookScript).toContain('def handle_prompt_submit')
    expect(hookScript).toContain('def handle_stop')
    expect(hookScript).toContain('no prompt, answer, or diff detected')
    expect(hookScript).not.toContain('no file changes detected')

    const hookConfig = await readJson<{ serverUrl: string; authToken: string; projectId: string }>(
      join(electronMock.userDataPath, 'claude-hooks', `${PROJECT_ID}.json`)
    )
    expect(hookConfig).toEqual({
      serverUrl: DEFAULT_SERVER_BASE_URL,
      authToken: 'rlv_test',
      projectId: PROJECT_ID
    })
  })

  it('disables Claude Code hooks and removes Relevo commands from the selected project folder', async () => {
    await seedSession()
    const projectFolder = await mkdtemp(join(tempRoot, 'project-folder-'))
    await saveProjectFolder(PROJECT_ID, projectFolder, DEFAULT_SERVER_BASE_URL)

    const settings = await setClaudeCodeHooksEnabled(false, DEFAULT_SERVER_BASE_URL)

    expect(settings.claudeCodeHooksEnabled).toBe(false)
    expect(settings.selectedProjectClaudeHook.active).toBe(false)
    expect(settings.selectedProjectClaudeHook.installed).toBe(false)
    const claudeSettings = await readJson<{
      hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string }> }>>
    }>(join(projectFolder, '.claude', 'settings.json'))
    const allCommands = Object.values(claudeSettings.hooks ?? {})
      .flat()
      .flatMap((matcher) => matcher.hooks.map((hook) => hook.command))
    expect(allCommands.some((command) => command.includes('relevo_activity.py'))).toBe(false)
    await expect(readFile(join(electronMock.userDataPath, 'claude-hooks', `${PROJECT_ID}.json`), 'utf-8')).rejects.toThrow()
  })

  it('leaves newly connected folders without Claude Code hooks when hook tracking is disabled', async () => {
    await seedSession()
    await setClaudeCodeHooksEnabled(false, DEFAULT_SERVER_BASE_URL)
    const projectFolder = await mkdtemp(join(tempRoot, 'project-folder-'))

    const settings = await saveProjectFolder(PROJECT_ID, projectFolder, DEFAULT_SERVER_BASE_URL)

    expect(settings.claudeCodeHooksEnabled).toBe(false)
    expect(settings.selectedProjectClaudeHook.active).toBe(false)
    await expect(readFile(join(projectFolder, '.claude', 'settings.json'), 'utf-8')).rejects.toThrow()
  })

  it('preserves existing Claude settings while adding one Relevo hook per event', async () => {
    await seedSession()
    const projectFolder = await mkdtemp(join(tempRoot, 'project-folder-'))
    await mkdir(join(projectFolder, '.claude'), { recursive: true })
    await writeFile(
      join(projectFolder, '.claude', 'settings.json'),
      JSON.stringify(
        {
          permissions: { allow: ['Bash(npm test)'] },
          hooks: {
            Stop: [
              {
                matcher: 'Write',
                hooks: [{ type: 'command', command: 'echo keep-me' }]
              }
            ]
          }
        },
        null,
        2
      ),
      'utf-8'
    )

    await saveProjectFolder(PROJECT_ID, projectFolder, DEFAULT_SERVER_BASE_URL)
    await saveProjectFolder(PROJECT_ID, projectFolder, DEFAULT_SERVER_BASE_URL)

    const claudeSettings = await readJson<{
      permissions: { allow: string[] }
      hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string }> }>>
    }>(join(projectFolder, '.claude', 'settings.json'))
    const allCommands = Object.values(claudeSettings.hooks)
      .flat()
      .flatMap((matcher) => matcher.hooks.map((hook) => hook.command))

    expect(claudeSettings.permissions.allow).toEqual(['Bash(npm test)'])
    expect(allCommands).toContain('echo keep-me')
    expect(allCommands.filter((command) => command.includes('relevo_activity.py'))).toHaveLength(2)
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

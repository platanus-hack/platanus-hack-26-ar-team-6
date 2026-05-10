import { app, safeStorage } from 'electron'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import {
  getClaudeCodeHookStatus,
  installClaudeCodeHook,
  removeClaudeCodeHook,
  removeClaudeCodeHookConfig,
  type ClaudeCodeHookStatus
} from './claudeHookInstaller.js'

type StoredSecret = {
  value: string
  encrypted: boolean
}

export type DesktopAccountSummary = {
  id: string
  email: string
  display_name: string
  avatar_url?: string | null
  email_verified: boolean
}

export type DesktopProjectMembership = {
  project_id: string
  project_name: string
  description?: string | null
  user_id: string
  display_name: string
  domain_summary: string
  role: 'leader' | 'member' | string
}

type StoredSettings = {
  anthropicApiKey?: StoredSecret
  relevoSessionToken?: StoredSecret
  account?: DesktopAccountSummary | null
  projects?: DesktopProjectMembership[]
  selectedProjectId?: string | null
  projectFolders?: Record<string, string>
  activityGraphEnabled?: boolean
  claudeCodeHooksEnabled?: boolean
}

export type DesktopSettingsResponse = {
  hasAnthropicApiKey: boolean
  encryptionAvailable: boolean
  serverBaseUrl: string
  isLoggedIn: boolean
  account: DesktopAccountSummary | null
  projects: DesktopProjectMembership[]
  selectedProjectId: string | null
  projectFolders: Record<string, string>
  selectedProjectFolderPath: string | null
  activityGraphEnabled: boolean
  claudeCodeHooksEnabled: boolean
  selectedProjectClaudeHook: ClaudeCodeHookStatus
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

async function readStoredSettings(): Promise<StoredSettings> {
  try {
    const text = await readFile(settingsPath(), 'utf-8')
    const data = JSON.parse(text) as StoredSettings
    return data && typeof data === 'object' ? data : {}
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

async function writeStoredSettings(settings: StoredSettings): Promise<void> {
  const filePath = settingsPath()
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8')
}

function encryptSecret(value: string): StoredSecret {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      value: safeStorage.encryptString(value).toString('base64'),
      encrypted: true
    }
  }

  return {
    value,
    encrypted: false
  }
}

function decryptSecret(storedSecret: StoredSecret, label: string): string {
  if (!storedSecret.encrypted) {
    return storedSecret.value
  }

  try {
    return safeStorage.decryptString(Buffer.from(storedSecret.value, 'base64'))
  } catch {
    throw new Error(`Saved ${label} could not be decrypted. Save it again in settings.`)
  }
}

export async function readAnthropicApiKey(): Promise<string | null> {
  const settings = await readStoredSettings()
  if (!settings.anthropicApiKey) {
    return null
  }

  const apiKey = decryptSecret(settings.anthropicApiKey, 'Anthropic API key').trim()
  return apiKey || null
}

export async function readRelevoSessionToken(): Promise<string | null> {
  const settings = await readStoredSettings()
  if (!settings.relevoSessionToken) {
    return null
  }

  const sessionToken = decryptSecret(settings.relevoSessionToken, 'Relevo session').trim()
  return sessionToken || null
}

function normalizeServerBaseUrl(serverBaseUrl: string): string {
  const trimmed = serverBaseUrl.trim()
  if (!trimmed) {
    throw new Error('VITE_API_BASE_URL is required for the desktop app.')
  }
  return trimmed.replace(/\/+$/, '')
}

function sanitizeSelectedProjectId(
  selectedProjectId: string | null | undefined,
  projects: DesktopProjectMembership[]
): string | null {
  if (!selectedProjectId) {
    return null
  }
  return projects.some((project) => project.project_id === selectedProjectId) ? selectedProjectId : null
}

function sanitizeProjectFolders(
  projectFolders: Record<string, string> | undefined,
  projects: DesktopProjectMembership[]
): Record<string, string> {
  const projectIds = new Set(projects.map((project) => project.project_id))
  const entries = Object.entries(projectFolders ?? {}).flatMap(([projectId, folderPath]) => {
    const trimmedPath = typeof folderPath === 'string' ? folderPath.trim() : ''
    if (!projectIds.has(projectId) || !trimmedPath) {
      return []
    }

    return [[projectId, trimmedPath]]
  })

  return Object.fromEntries(entries)
}

export async function resolveProjectFolderPath(folderPath: string): Promise<string> {
  const trimmedPath = folderPath.trim()
  if (!trimmedPath) {
    throw new Error('Project folder cannot be empty.')
  }

  const resolvedPath = resolve(trimmedPath)
  let stats
  try {
    stats = await stat(resolvedPath)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Project folder must be an existing directory: ${resolvedPath}`)
    }
    throw error
  }

  if (!stats.isDirectory()) {
    throw new Error(`Project folder must be a directory: ${resolvedPath}`)
  }

  return resolvedPath
}

export async function getDesktopSettings(defaultServerBaseUrl: string): Promise<DesktopSettingsResponse> {
  const settings = await readStoredSettings()
  const projects = settings.projects ?? []
  const selectedProjectId = sanitizeSelectedProjectId(settings.selectedProjectId, projects)
  const projectFolders = sanitizeProjectFolders(settings.projectFolders, projects)
  const sessionToken = await readRelevoSessionToken()
  const selectedProjectFolderPath = selectedProjectId ? (projectFolders[selectedProjectId] ?? null) : null
  const claudeCodeHooksEnabled = settings.claudeCodeHooksEnabled ?? true
  const selectedProjectClaudeHook = await getClaudeCodeHookStatus(
    selectedProjectFolderPath,
    selectedProjectId,
    claudeCodeHooksEnabled
  )

  return {
    hasAnthropicApiKey: Boolean(await readAnthropicApiKey()),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    serverBaseUrl: normalizeServerBaseUrl(defaultServerBaseUrl),
    isLoggedIn: Boolean(sessionToken && settings.account),
    account: settings.account ?? null,
    projects,
    selectedProjectId,
    projectFolders,
    selectedProjectFolderPath,
    activityGraphEnabled: settings.activityGraphEnabled ?? false,
    claudeCodeHooksEnabled,
    selectedProjectClaudeHook
  }
}

export async function saveAnthropicApiKey(
  apiKey: string,
  defaultServerBaseUrl: string
): Promise<DesktopSettingsResponse> {
  const trimmedApiKey = apiKey.trim()
  if (!trimmedApiKey) {
    throw new Error('Anthropic API key cannot be empty.')
  }

  const settings = await readStoredSettings()
  await writeStoredSettings({
    ...settings,
    anthropicApiKey: encryptSecret(trimmedApiKey)
  })
  return getDesktopSettings(defaultServerBaseUrl)
}

export async function clearAnthropicApiKey(defaultServerBaseUrl: string): Promise<DesktopSettingsResponse> {
  const settings = await readStoredSettings()
  const nextSettings = { ...settings }
  delete nextSettings.anthropicApiKey
  await writeStoredSettings(nextSettings)
  return getDesktopSettings(defaultServerBaseUrl)
}

export async function saveRelevoSession(
  input: {
    sessionToken: string
    account: DesktopAccountSummary
    projects: DesktopProjectMembership[]
  },
  defaultServerBaseUrl: string
): Promise<DesktopSettingsResponse> {
  const settings = await readStoredSettings()
  const sessionToken = input.sessionToken.trim()
  if (!sessionToken) {
    throw new Error('Relevo session token cannot be empty.')
  }

  await writeStoredSettings({
    ...settings,
    relevoSessionToken: encryptSecret(sessionToken),
    account: input.account,
    projects: input.projects,
    selectedProjectId: null,
    projectFolders: {}
  })
  return getDesktopSettings(defaultServerBaseUrl)
}

export async function saveRelevoAuthState(
  input: {
    account: DesktopAccountSummary
    projects: DesktopProjectMembership[]
  },
  defaultServerBaseUrl: string
): Promise<DesktopSettingsResponse> {
  const settings = await readStoredSettings()
  await writeStoredSettings({
    ...settings,
    account: input.account,
    projects: input.projects,
    selectedProjectId: sanitizeSelectedProjectId(settings.selectedProjectId, input.projects),
    projectFolders: sanitizeProjectFolders(settings.projectFolders, input.projects)
  })
  return getDesktopSettings(defaultServerBaseUrl)
}

export async function clearRelevoSession(defaultServerBaseUrl: string): Promise<DesktopSettingsResponse> {
  const settings = await readStoredSettings()
  const projectFolders = sanitizeProjectFolders(settings.projectFolders, settings.projects ?? [])
  await Promise.all(Object.values(projectFolders).map((folderPath) => removeClaudeCodeHook(folderPath)))
  await Promise.all(Object.keys(projectFolders).map((projectId) => removeClaudeCodeHookConfig(projectId)))
  const nextSettings = { ...settings }
  delete nextSettings.relevoSessionToken
  await writeStoredSettings({
    ...nextSettings,
    account: null,
    projects: [],
    selectedProjectId: null,
    projectFolders: {},
    claudeCodeHooksEnabled: settings.claudeCodeHooksEnabled ?? true
  })
  return getDesktopSettings(defaultServerBaseUrl)
}

export async function saveSelectedProjectId(
  projectId: string,
  defaultServerBaseUrl: string
): Promise<DesktopSettingsResponse> {
  const settings = await readStoredSettings()
  const projects = settings.projects ?? []
  if (!projects.some((project) => project.project_id === projectId)) {
    throw new Error('Selected project is not in the current account project list.')
  }

  await writeStoredSettings({
    ...settings,
    selectedProjectId: projectId,
    projectFolders: sanitizeProjectFolders(settings.projectFolders, projects)
  })
  return getDesktopSettings(defaultServerBaseUrl)
}

export async function saveProjectFolder(
  projectId: string,
  folderPath: string,
  defaultServerBaseUrl: string
): Promise<DesktopSettingsResponse> {
  const settings = await readStoredSettings()
  const projects = settings.projects ?? []
  if (!projects.some((project) => project.project_id === projectId)) {
    throw new Error('Project folder can only be set for a current account project.')
  }

  const resolvedFolderPath = await resolveProjectFolderPath(folderPath)
  const sessionToken = await readRelevoSessionToken()
  if (!sessionToken) {
    throw new Error('Sign in with Google before connecting a project folder.')
  }

  if (settings.claudeCodeHooksEnabled ?? true) {
    await installClaudeCodeHook({
      projectId,
      projectFolderPath: resolvedFolderPath,
      serverUrl: normalizeServerBaseUrl(defaultServerBaseUrl),
      authToken: sessionToken
    })
  } else {
    await removeClaudeCodeHook(resolvedFolderPath)
    await removeClaudeCodeHookConfig(projectId)
  }

  const projectFolders = sanitizeProjectFolders(settings.projectFolders, projects)
  await writeStoredSettings({
    ...settings,
    projectFolders: {
      ...projectFolders,
      [projectId]: resolvedFolderPath
    }
  })
  return getDesktopSettings(defaultServerBaseUrl)
}

export async function toggleActivityGraph(
  enabled: boolean,
  defaultServerBaseUrl: string
): Promise<DesktopSettingsResponse> {
  const settings = await readStoredSettings()
  await writeStoredSettings({ ...settings, activityGraphEnabled: enabled })
  return getDesktopSettings(defaultServerBaseUrl)
}

export async function setClaudeCodeHooksEnabled(
  enabled: boolean,
  defaultServerBaseUrl: string
): Promise<DesktopSettingsResponse> {
  const settings = await readStoredSettings()
  const projects = settings.projects ?? []
  const projectFolders = sanitizeProjectFolders(settings.projectFolders, projects)

  if (enabled) {
    const sessionToken = await readRelevoSessionToken()
    if (!sessionToken) {
      throw new Error('Sign in with Google before enabling Claude Code hooks.')
    }
    await Promise.all(
      Object.entries(projectFolders).map(([projectId, projectFolderPath]) =>
        installClaudeCodeHook({
          projectId,
          projectFolderPath,
          serverUrl: normalizeServerBaseUrl(defaultServerBaseUrl),
          authToken: sessionToken
        })
      )
    )
  } else {
    await Promise.all(Object.values(projectFolders).map((projectFolderPath) => removeClaudeCodeHook(projectFolderPath)))
    await Promise.all(Object.keys(projectFolders).map((projectId) => removeClaudeCodeHookConfig(projectId)))
  }

  await writeStoredSettings({
    ...settings,
    projectFolders,
    claudeCodeHooksEnabled: enabled
  })
  return getDesktopSettings(defaultServerBaseUrl)
}

export async function clearProjectFolder(
  projectId: string,
  defaultServerBaseUrl: string
): Promise<DesktopSettingsResponse> {
  const settings = await readStoredSettings()
  const projects = settings.projects ?? []
  if (!projects.some((project) => project.project_id === projectId)) {
    throw new Error('Project folder can only be cleared for a current account project.')
  }

  const projectFolders = sanitizeProjectFolders(settings.projectFolders, projects)
  const projectFolderPath = projectFolders[projectId]
  if (projectFolderPath) {
    await removeClaudeCodeHook(projectFolderPath)
    await removeClaudeCodeHookConfig(projectId)
  }
  delete projectFolders[projectId]
  await writeStoredSettings({
    ...settings,
    projectFolders
  })
  return getDesktopSettings(defaultServerBaseUrl)
}

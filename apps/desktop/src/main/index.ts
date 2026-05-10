import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, resolve } from 'node:path'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { runLocalAssistant } from '../runner.js'
import type { BootstrapContext, ConversationMessage, PersistedConversation, RunLocalAssistantOptions } from '../types.js'
import {
  clearAnthropicApiKey,
  clearProjectFolder,
  clearRelevoSession,
  getDesktopSettings,
  readAnthropicApiKey,
  readRelevoSessionToken,
  saveAnthropicApiKey,
  saveProjectFolder,
  saveRelevoAuthState,
  saveRelevoSession,
  saveSelectedProjectId,
  setClaudeCodeHooksEnabled,
  toggleActivityGraph,
  type DesktopAccountSummary,
  type DesktopProjectMembership,
  type DesktopSettingsResponse
} from './settings.js'
import { saveActivityNote, readActivityNotes, type ActivityToolEntry, type ActivityNote } from '../activityMarkdown.js'
import {
  loadResponsibilities as loadResponsibilitiesClient,
  loadTeamPulse as loadTeamPulseClient,
  loadTeamPulseRawEvents as loadTeamPulseRawEventsClient,
  refreshTeamPulse as refreshTeamPulseClient,
  type ResponsibilitiesResponse,
  type TeamPulseRawEvent,
  type TeamPulseRefreshResult,
  type TeamPulseResponse
} from '../teamPulse.js'
import {
  loadProjectGraph as loadProjectGraphClient,
  type ProjectGraphResponse
} from '../projectGraph.js'
import { commitMemoryUpdate } from '../memoryTools.js'
import {
  isMissingRailwaywiseEndpointError,
  resolveRailwaywiseProjectId
} from '../demoRailwaywise.js'

const viteEnv = import.meta.env as unknown as Record<string, string | undefined>
const FALLBACK_API_BASE_URL = 'https://platanus-hack-26-ar-team-6-production-75c7.up.railway.app'
const DEFAULT_API_BASE_URL = viteEnv['VITE_API_BASE_URL'] || process.env['VITE_API_BASE_URL'] || FALLBACK_API_BASE_URL
const DESKTOP_REDIRECT_URI = 'relevo://auth/callback'

const _runningAssistantSenders = new Set<number>()

type HealthResponse = {
  status?: string
  sha?: string
}

type BootstrapUser = {
  id: string
  display_name: string
  domain_summary: string
  profile: Record<string, unknown>
  role?: string | null
  account_id?: string | null
}

type BootstrapProject = {
  id: string
  name: string
  description?: string | null
}

type BootstrapContextEntry = {
  id: string
  kind: string
  content: string
  metadata: Record<string, unknown>
  created_at: unknown
}

type BootstrapResponse = {
  user: BootstrapUser
  project: BootstrapProject
  roster: BootstrapUser[]
  recent_entries: BootstrapContextEntry[]
  project_context: BootstrapContextEntry[]
}

type AuthStateResponse = {
  account: DesktopAccountSummary
  projects: DesktopProjectMembership[]
}

type DesktopExchangeResponse = AuthStateResponse & {
  session_token: string
}

type StartAssistantRunPayload = {
  prompt: string
  cwd?: string
  bootstrap: BootstrapContext
  userId: string
  chatSessionId?: string
  conversationMessages?: ConversationMessage[]
  mentionedAgentIds?: string[]
  model?: string
  maxTurns?: number
}

type CreateProjectPayload = {
  name: string
  description?: string | null
  domainSummary?: string | null
}

type AddProjectMemberPayload = {
  projectId: string
  email: string
  domainSummary: string
}

type AuthEvent =
  | { type: 'login:pending' }
  | { type: 'login:succeeded'; settings: DesktopSettingsResponse }
  | { type: 'login:failed'; message: string }
  | { type: 'logout:succeeded'; settings: DesktopSettingsResponse }
  | { type: 'projects:updated'; settings: DesktopSettingsResponse }
  | { type: 'project:selected'; settings: DesktopSettingsResponse }
  | { type: 'project:folder:updated'; settings: DesktopSettingsResponse }

type SessionContext = {
  serverBaseUrl: string
  sessionToken: string
  selectedProjectId: string
}

let mainWindow: BrowserWindow | null = null
let pendingProtocolUrls: string[] = []

function normalizeBaseUrl(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.trim()
  if (!trimmed) {
    throw new Error('VITE_API_BASE_URL is required for the desktop app.')
  }
  return trimmed.replace(/\/+$/, '')
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status} ${response.statusText}: ${text}`)
  }

  return response.json() as Promise<T>
}

function notifyAuthEvent(event: AuthEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('auth:event', event)
  }
}

function fallbackRunnerCwd(payloadCwd?: string): string {
  return payloadCwd ?? viteEnv['VITE_LOCAL_REPO_PATH'] ?? process.env['VITE_LOCAL_REPO_PATH'] ?? '.'
}

function conversationFilePath(workspaceId: string): string {
  return join(app.getPath('userData'), 'conversations', `${workspaceId}.json`)
}

async function loadConversationFromDisk(workspaceId: string): Promise<PersistedConversation> {
  try {
    const raw = await readFile(conversationFilePath(workspaceId), 'utf-8')
    return JSON.parse(raw) as PersistedConversation
  } catch {
    return { sessionId: null, messages: [] }
  }
}

async function saveConversationToDisk(workspaceId: string, data: PersistedConversation): Promise<void> {
  const dir = join(app.getPath('userData'), 'conversations')
  await mkdir(dir, { recursive: true })
  await writeFile(conversationFilePath(workspaceId), JSON.stringify(data), 'utf-8')
}

async function clearConversationFromDisk(workspaceId: string): Promise<void> {
  try {
    await unlink(conversationFilePath(workspaceId))
  } catch {
    // file may not exist
  }
}

async function selectDirectory(parentWindow: BrowserWindow | null): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    properties: ['openDirectory']
  }
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled) {
    return null
  }

  return result.filePaths[0] ?? null
}

function focusMainWindow(): void {
  const window = mainWindow ?? BrowserWindow.getAllWindows()[0]
  if (!window) {
    return
  }
  if (window.isMinimized()) {
    window.restore()
  }
  window.show()
  window.focus()
}

function configureProtocolClient(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('relevo', process.execPath, [resolve(process.argv[1])])
    return
  }

  app.setAsDefaultProtocolClient('relevo')
}

async function exchangeDesktopLoginCode(code: string): Promise<DesktopSettingsResponse> {
  const settings = await getDesktopSettings(DEFAULT_API_BASE_URL)
  const exchangeUrl = new URL('/auth/desktop/exchange', settings.serverBaseUrl)
  const exchange = await fetchJson<DesktopExchangeResponse>(exchangeUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ code })
  })

  return saveRelevoSession(
    {
      sessionToken: exchange.session_token,
      account: exchange.account,
      projects: exchange.projects
    },
    DEFAULT_API_BASE_URL
  )
}

async function handleProtocolUrl(rawUrl: string): Promise<void> {
  if (!app.isReady()) {
    pendingProtocolUrls.push(rawUrl)
    return
  }

  focusMainWindow()
  notifyAuthEvent({ type: 'login:pending' })

  try {
    const callbackUrl = new URL(rawUrl)
    const isAuthCallback = callbackUrl.protocol === 'relevo:' && callbackUrl.hostname === 'auth'
    if (!isAuthCallback) {
      throw new Error('Unsupported Relevo callback URL.')
    }

    const error = callbackUrl.searchParams.get('error')
    if (error) {
      throw new Error(`Google login failed: ${error}`)
    }

    const code = callbackUrl.searchParams.get('code')
    if (!code) {
      throw new Error('Google login callback did not include a code.')
    }

    const settings = await exchangeDesktopLoginCode(code)
    notifyAuthEvent({ type: 'login:succeeded', settings })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    notifyAuthEvent({ type: 'login:failed', message })
  }
}

function flushPendingProtocolUrls(): void {
  const urls = pendingProtocolUrls
  pendingProtocolUrls = []
  for (const url of urls) {
    void handleProtocolUrl(url)
  }
}

async function getSessionContext(requireProject = true): Promise<SessionContext> {
  const settings = await getDesktopSettings(DEFAULT_API_BASE_URL)
  const sessionToken = await readRelevoSessionToken()

  if (!sessionToken) {
    throw new Error('Sign in with Google before using the Relevo API.')
  }
  if (requireProject && !settings.selectedProjectId) {
    throw new Error('Select a project before using the Relevo API.')
  }

  return {
    serverBaseUrl: settings.serverBaseUrl,
    sessionToken,
    selectedProjectId: settings.selectedProjectId ?? ''
  }
}

async function refreshProjectsFromServer(): Promise<DesktopSettingsResponse> {
  const { serverBaseUrl, sessionToken } = await getSessionContext(false)
  const stateUrl = new URL('/me/projects', serverBaseUrl)
  const state = await fetchJson<AuthStateResponse>(stateUrl.toString(), {
    headers: {
      Authorization: `Bearer ${sessionToken}`
    }
  })
  return saveRelevoAuthState(state, DEFAULT_API_BASE_URL)
}

async function ensureRailwaywise(): Promise<DesktopSettingsResponse> {
  const { serverBaseUrl, sessionToken } = await getSessionContext(false)
  const railwaywiseUrl = new URL('/demo/railwaywise', serverBaseUrl)
  let railwaywiseResponse: unknown
  try {
    railwaywiseResponse = await fetchJson<unknown>(railwaywiseUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'Content-Type': 'application/json'
      }
    })
  } catch (error) {
    if (!isMissingRailwaywiseEndpointError(error)) {
      throw error
    }
    const existingSettings = await refreshProjectsFromServer()
    const existingProject = existingSettings.projects.find((project) =>
      project.project_name.toLowerCase().includes('railwaywise')
    )
    if (existingProject) {
      return saveSelectedProjectId(existingProject.project_id, DEFAULT_API_BASE_URL)
    }

    const createUrl = new URL('/projects', serverBaseUrl)
    railwaywiseResponse = await fetchJson<unknown>(createUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Railwaywise',
        description: 'AI-assisted railway operations workspace.',
        domain_summary:
          'Railwaywise operations lead coordinating dispatch, maintenance, signals, passenger communications, and integrations.'
      })
    })
  }
  const refreshedSettings = await refreshProjectsFromServer()
  const projectId = resolveRailwaywiseProjectId(railwaywiseResponse, refreshedSettings.projects)
  return saveSelectedProjectId(projectId, DEFAULT_API_BASE_URL)
}

function createWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusMainWindow()
    return
  }

  const window = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindow = window

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

configureProtocolClient()

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

app.on('second-instance', (_event, argv) => {
  const protocolUrl = argv.find((arg) => arg.startsWith('relevo://'))
  if (protocolUrl) {
    void handleProtocolUrl(protocolUrl)
  } else {
    focusMainWindow()
  }
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  void handleProtocolUrl(url)
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('health:check', async (_, apiBaseUrl: string): Promise<HealthResponse> => {
    const normalizedBaseUrl = normalizeBaseUrl(apiBaseUrl)
    const response = await fetch(`${normalizedBaseUrl}/health`)

    if (!response.ok) {
      throw new Error('health request failed')
    }

    return response.json()
  })

  ipcMain.handle('settings:get', async (): Promise<DesktopSettingsResponse> => {
    return getDesktopSettings(DEFAULT_API_BASE_URL)
  })

  ipcMain.handle('settings:anthropic-key:save', async (_, apiKey: string): Promise<DesktopSettingsResponse> => {
    return saveAnthropicApiKey(apiKey, DEFAULT_API_BASE_URL)
  })

  ipcMain.handle('settings:anthropic-key:clear', async (): Promise<DesktopSettingsResponse> => {
    return clearAnthropicApiKey(DEFAULT_API_BASE_URL)
  })

  ipcMain.handle('auth:login:start', async (): Promise<DesktopSettingsResponse> => {
    const baseUrl = (await getDesktopSettings(DEFAULT_API_BASE_URL)).serverBaseUrl
    const loginUrl = new URL('/auth/google/start', baseUrl)
    loginUrl.searchParams.set('desktop_redirect_uri', DESKTOP_REDIRECT_URI)
    await shell.openExternal(loginUrl.toString())
    return getDesktopSettings(DEFAULT_API_BASE_URL)
  })

  ipcMain.handle('auth:logout', async (): Promise<DesktopSettingsResponse> => {
    const settings = await getDesktopSettings(DEFAULT_API_BASE_URL)
    const sessionToken = await readRelevoSessionToken()

    if (sessionToken) {
      const logoutUrl = new URL('/auth/logout', settings.serverBaseUrl)
      await fetch(logoutUrl.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`
        }
      }).catch(() => undefined)
    }

    const nextSettings = await clearRelevoSession(DEFAULT_API_BASE_URL)
    notifyAuthEvent({ type: 'logout:succeeded', settings: nextSettings })
    return nextSettings
  })

  ipcMain.handle('auth:projects:refresh', async (): Promise<DesktopSettingsResponse> => {
    const settings = await refreshProjectsFromServer()
    notifyAuthEvent({ type: 'projects:updated', settings })
    return settings
  })

  ipcMain.handle('railwaywise:ensure', async (): Promise<DesktopSettingsResponse> => {
    const settings = await ensureRailwaywise()
    notifyAuthEvent({ type: 'projects:updated', settings })
    return settings
  })

  ipcMain.handle('project:select', async (_, projectId: string): Promise<DesktopSettingsResponse> => {
    const settings = await saveSelectedProjectId(projectId, DEFAULT_API_BASE_URL)
    notifyAuthEvent({ type: 'project:selected', settings })
    return settings
  })

  ipcMain.handle('project:folder:choose', async (event, projectId: string): Promise<DesktopSettingsResponse> => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    const folderPath = await selectDirectory(parentWindow)
    if (!folderPath) {
      return getDesktopSettings(DEFAULT_API_BASE_URL)
    }

    const settings = await saveProjectFolder(projectId, folderPath, DEFAULT_API_BASE_URL)
    notifyAuthEvent({ type: 'project:folder:updated', settings })
    return settings
  })

  ipcMain.handle('project:folder:clear', async (_, projectId: string): Promise<DesktopSettingsResponse> => {
    const settings = await clearProjectFolder(projectId, DEFAULT_API_BASE_URL)
    notifyAuthEvent({ type: 'project:folder:updated', settings })
    return settings
  })

  ipcMain.handle('project:create', async (_, request: CreateProjectPayload): Promise<DesktopSettingsResponse> => {
    const { serverBaseUrl, sessionToken } = await getSessionContext(false)
    const createUrl = new URL('/projects', serverBaseUrl)
    const created = await fetchJson<DesktopProjectMembership>(createUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: request.name,
        description: request.description ?? null,
        domain_summary: request.domainSummary ?? null
      })
    })
    await refreshProjectsFromServer()
    const settings = await saveSelectedProjectId(created.project_id, DEFAULT_API_BASE_URL)
    notifyAuthEvent({ type: 'projects:updated', settings })
    return settings
  })

  ipcMain.handle('project:delete', async (_, projectId: string): Promise<DesktopSettingsResponse> => {
    const { serverBaseUrl, sessionToken } = await getSessionContext(false)
    const deleteUrl = new URL(`/projects/${projectId}`, serverBaseUrl)
    const state = await fetchJson<AuthStateResponse>(deleteUrl.toString(), {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${sessionToken}`
      }
    })
    const settings = await saveRelevoAuthState(state, DEFAULT_API_BASE_URL)
    notifyAuthEvent({ type: 'projects:updated', settings })
    return settings
  })

  ipcMain.handle('project:leave', async (_, projectId: string): Promise<DesktopSettingsResponse> => {
    const { serverBaseUrl, sessionToken } = await getSessionContext(false)
    const leaveUrl = new URL(`/projects/${projectId}/membership`, serverBaseUrl)
    const state = await fetchJson<AuthStateResponse>(leaveUrl.toString(), {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${sessionToken}`
      }
    })
    const settings = await saveRelevoAuthState(state, DEFAULT_API_BASE_URL)
    notifyAuthEvent({ type: 'projects:updated', settings })
    return settings
  })

  ipcMain.handle(
    'project:member:add',
    async (_, request: AddProjectMemberPayload): Promise<DesktopProjectMembership> => {
      const { serverBaseUrl, sessionToken } = await getSessionContext(false)
      const memberUrl = new URL(`/projects/${request.projectId}/members`, serverBaseUrl)
      return fetchJson<DesktopProjectMembership>(memberUrl.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: request.email,
          domain_summary: request.domainSummary
        })
      })
    }
  )

  ipcMain.handle('bootstrap:load', async (): Promise<BootstrapResponse> => {
    const { serverBaseUrl, sessionToken, selectedProjectId } = await getSessionContext()
    const bootstrapUrl = new URL('/bootstrap', serverBaseUrl)
    bootstrapUrl.searchParams.set('project_id', selectedProjectId)

    return fetchJson<BootstrapResponse>(bootstrapUrl.toString(), {
      headers: {
        Authorization: `Bearer ${sessionToken}`
      }
    })
  })

  ipcMain.handle('conversation:load', async (_, workspaceId: string): Promise<PersistedConversation> => {
    return loadConversationFromDisk(workspaceId)
  })

  ipcMain.handle('conversation:save', async (_, workspaceId: string, data: PersistedConversation): Promise<void> => {
    await saveConversationToDisk(workspaceId, data)
  })

  ipcMain.handle('conversation:clear', async (_, workspaceId: string): Promise<void> => {
    await clearConversationFromDisk(workspaceId)
  })


  ipcMain.handle('settings:activity-graph:toggle', async (_, enabled: boolean): Promise<DesktopSettingsResponse> => {
    return toggleActivityGraph(enabled, DEFAULT_API_BASE_URL)
  })

  ipcMain.handle('settings:claude-hooks:set-enabled', async (_, enabled: boolean): Promise<DesktopSettingsResponse> => {
    return setClaudeCodeHooksEnabled(enabled, DEFAULT_API_BASE_URL)
  })

  ipcMain.handle('activity-graph:get-notes', async (_, projectFolderPath: string): Promise<ActivityNote[]> => {
    return readActivityNotes(projectFolderPath)
  })

  ipcMain.handle(
    'team-pulse:load',
    async (_, opts?: { bucketSize?: number; bucketCount?: number }): Promise<TeamPulseResponse> => {
      const { serverBaseUrl, sessionToken, selectedProjectId } = await getSessionContext()
      const bootstrap = await fetchJson<BootstrapResponse>(
        new URL(`/bootstrap?project_id=${selectedProjectId}`, serverBaseUrl).toString(),
        { headers: { Authorization: `Bearer ${sessionToken}` } }
      )
      return loadTeamPulseClient({
        serverBaseUrl,
        sessionToken,
        projectId: selectedProjectId,
        selfAgentId: bootstrap.user.id,
        bucketSize: opts?.bucketSize,
        bucketCount: opts?.bucketCount
      })
    }
  )

  ipcMain.handle(
    'team-pulse:raw-events',
    async (
      _,
      opts?: {
        agentId?: string
        since?: string
        until?: string
        bucketSize?: number
        bucketCount?: number
      }
    ): Promise<TeamPulseRawEvent[]> => {
      const { serverBaseUrl, sessionToken, selectedProjectId } = await getSessionContext()
      const bootstrap = await fetchJson<BootstrapResponse>(
        new URL(`/bootstrap?project_id=${selectedProjectId}`, serverBaseUrl).toString(),
        { headers: { Authorization: `Bearer ${sessionToken}` } }
      )
      return loadTeamPulseRawEventsClient(
        {
          serverBaseUrl,
          sessionToken,
          projectId: selectedProjectId,
          selfAgentId: bootstrap.user.id,
          bucketSize: opts?.bucketSize,
          bucketCount: opts?.bucketCount
        },
        {
          agentId: opts?.agentId,
          since: opts?.since,
          until: opts?.until,
          bucketSize: opts?.bucketSize,
          bucketCount: opts?.bucketCount
        }
      )
    }
  )

  ipcMain.handle(
    'team-pulse:refresh',
    async (_, opts?: { bucketSize?: number; bucketCount?: number }): Promise<TeamPulseRefreshResult> => {
      const { serverBaseUrl, sessionToken, selectedProjectId } = await getSessionContext()
      const bootstrap = await fetchJson<BootstrapResponse>(
        new URL(`/bootstrap?project_id=${selectedProjectId}`, serverBaseUrl).toString(),
        { headers: { Authorization: `Bearer ${sessionToken}` } }
      )
      const anthropicApiKey = await readAnthropicApiKey()
      return refreshTeamPulseClient({
        serverBaseUrl,
        sessionToken,
        projectId: selectedProjectId,
        selfAgentId: bootstrap.user.id,
        anthropicApiKey,
        bucketSize: opts?.bucketSize,
        bucketCount: opts?.bucketCount
      })
    }
  )

  ipcMain.handle('responsibilities:load', async (): Promise<ResponsibilitiesResponse> => {
    const { serverBaseUrl, sessionToken, selectedProjectId } = await getSessionContext()
    return loadResponsibilitiesClient({ serverBaseUrl, sessionToken, projectId: selectedProjectId })
  })

  ipcMain.handle(
    'graph:load',
    async (
      _,
      opts?: { includeLocal?: boolean; maxDocs?: number; maxEvents?: number; maxExchanges?: number }
    ): Promise<ProjectGraphResponse> => {
      const { serverBaseUrl, sessionToken, selectedProjectId } = await getSessionContext()
      return loadProjectGraphClient({
        serverBaseUrl,
        sessionToken,
        projectId: selectedProjectId,
        includeLocal: opts?.includeLocal,
        maxDocs: opts?.maxDocs,
        maxEvents: opts?.maxEvents,
        maxExchanges: opts?.maxExchanges
      })
    }
  )

  ipcMain.handle('tasks:sync', async (_, payload: {
    userId: string
    projectId: string
    eventContent: string
    canonicalContent: string
  }) => {
    const { serverBaseUrl, sessionToken } = await getSessionContext(false)
    return commitMemoryUpdate(
      {
        serverUrl: serverBaseUrl,
        userId: payload.userId,
        authToken: sessionToken,
        projectId: payload.projectId,
      },
      {
        chat_session_id: `tasks-board:${payload.projectId}:${payload.userId}`,
        checkpoint_index: 1,
        operations: [{
          author_agent_id: payload.userId,
          importance: 'global',
          document_key: 'tasks',
          event_content: payload.eventContent,
          canonical_content: payload.canonicalContent,
          metadata: { source: 'task-board' },
        }],
      }
    )
  })

  ipcMain.handle('assistant:run:start', async (event, payload: StartAssistantRunPayload): Promise<void> => {
    const senderId = event.sender.id
    if (_runningAssistantSenders.has(senderId)) {
      event.sender.send('assistant:event', {
        type: 'error',
        message: 'A run is already in progress',
      })
      return
    }
    _runningAssistantSenders.add(senderId)

    try {
      const anthropicApiKey = await readAnthropicApiKey()
      if (!anthropicApiKey) {
        throw new Error('Anthropic API key is not configured. Open settings and save a key.')
      }

      const { serverBaseUrl, sessionToken, selectedProjectId } = await getSessionContext()
      const settings = await getDesktopSettings(DEFAULT_API_BASE_URL)
      const runOptions: RunLocalAssistantOptions = {
        ...payload,
        cwd: settings.selectedProjectFolderPath ?? fallbackRunnerCwd(payload.cwd),
        anthropicApiKey,
        serverUrl: serverBaseUrl,
        authToken: sessionToken,
        projectId: selectedProjectId
      }

      const runToolTrace: ActivityToolEntry[] = []
      let finalSessionId: string | undefined
      let finalAnswer = ''
      let activityTitle: string | undefined

      for await (const assistantEvent of runLocalAssistant(runOptions)) {
        if (event.sender.isDestroyed()) break
        event.sender.send('assistant:event', assistantEvent)
        if (assistantEvent.type === 'tool_call') {
          runToolTrace.push({
            toolName: assistantEvent.toolName,
            toolUseId: assistantEvent.toolUseId,
            input: assistantEvent.input
          })
        } else if (assistantEvent.type === 'result') {
          finalSessionId = assistantEvent.sessionId
          finalAnswer = assistantEvent.result
        } else if (assistantEvent.type === 'activity_title') {
          activityTitle = assistantEvent.title
        }
      }

      if (settings.activityGraphEnabled && settings.account && settings.selectedProjectFolderPath) {
        const project = settings.projects.find((p) => p.project_id === selectedProjectId)
        if (project) {
          void saveActivityNote({
            sessionId: finalSessionId ?? `${Date.now()}`,
            prompt: payload.prompt,
            finalAnswer,
            activityTitle,
            toolTrace: runToolTrace,
            displayName: settings.account.display_name,
            email: settings.account.email,
            projectName: project.project_name,
            projectFolderPath: settings.selectedProjectFolderPath
          }).catch((err) => console.error('[activity-graph]', err))
        }
      }
    } catch (error) {
      if (!event.sender.isDestroyed()) {
        event.sender.send('assistant:event', {
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    } finally {
      _runningAssistantSenders.delete(senderId)
    }
  })

  createWindow()
  flushPendingProtocolUrls()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

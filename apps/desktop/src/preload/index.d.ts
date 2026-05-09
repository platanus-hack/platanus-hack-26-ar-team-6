import { ElectronAPI } from '@electron-toolkit/preload'

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

type BootstrapPayload = {
  user_summary?: unknown
  project_context?: unknown
}

type StartAssistantRunPayload = {
  prompt: string
  cwd: string
  bootstrap: BootstrapPayload
  userId: string
  model?: string
  maxTurns?: number
}

type LocalAssistantEvent =
  | { type: 'assistant_text'; text: string }
  | {
      type: 'tool_call'
      toolName: string
      toolUseId: string
      input: unknown
    }
  | {
      type: 'tool_status'
      toolName: string
      toolUseId: string
      elapsedTimeSeconds?: number
    }
  | {
      type: 'tool_result'
      toolUseId: string
      result?: {
        answer: string
        source_user_ids: string[]
        citations: Record<string, unknown>[]
      }
      errorMessage?: string
    }
  | {
      type: 'result'
      result: string
      sessionId?: string
    }
  | {
      type: 'error'
      message: string
      sessionId?: string
    }
  | {
      type: 'raw'
      messageType: string
      message: unknown
    }
;

type SavePromptAnswerResponse = {
  id: string
  kind: string
}

type DesktopSettingsResponse = {
  hasAnthropicApiKey: boolean
  encryptionAvailable: boolean
  serverBaseUrl: string
  isLoggedIn: boolean
  account: DesktopAccountSummary | null
  projects: DesktopProjectMembership[]
  selectedProjectId: string | null
}

type DesktopAccountSummary = {
  id: string
  email: string
  display_name: string
  avatar_url?: string | null
  email_verified: boolean
}

type DesktopProjectMembership = {
  project_id: string
  project_name: string
  description?: string | null
  user_id: string
  display_name: string
  domain_summary: string
  role: string
}

type AuthEvent =
  | { type: 'login:pending' }
  | { type: 'login:succeeded'; settings: DesktopSettingsResponse }
  | { type: 'login:failed'; message: string }
  | { type: 'logout:succeeded'; settings: DesktopSettingsResponse }
  | { type: 'projects:updated'; settings: DesktopSettingsResponse }
  | { type: 'project:selected'; settings: DesktopSettingsResponse }

type CreateProjectRequest = {
  name: string
  description?: string | null
  domainSummary?: string | null
}

type AddProjectMemberRequest = {
  projectId: string
  email: string
  domainSummary: string
}

interface DesktopApi {
  getHealth: (apiBaseUrl: string) => Promise<HealthResponse>
  getSettings: () => Promise<DesktopSettingsResponse>
  saveAnthropicApiKey: (apiKey: string) => Promise<DesktopSettingsResponse>
  clearAnthropicApiKey: () => Promise<DesktopSettingsResponse>
  startGoogleLogin: () => Promise<DesktopSettingsResponse>
  logout: () => Promise<DesktopSettingsResponse>
  refreshProjects: () => Promise<DesktopSettingsResponse>
  selectProject: (projectId: string) => Promise<DesktopSettingsResponse>
  createProject: (request: CreateProjectRequest) => Promise<DesktopSettingsResponse>
  deleteProject: (projectId: string) => Promise<DesktopSettingsResponse>
  addProjectMember: (request: AddProjectMemberRequest) => Promise<DesktopProjectMembership>
  getBootstrap: () => Promise<BootstrapResponse>
  savePromptAnswer: (request: {
    prompt: string
    finalAnswer: string
    metadata?: Record<string, unknown>
  }) => Promise<SavePromptAnswerResponse>
  startAssistantRun: (payload: StartAssistantRunPayload) => Promise<void>
  onAuthEvent: (callback: (event: AuthEvent) => void) => () => void
  onAssistantEvent: (callback: (event: LocalAssistantEvent) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DesktopApi
  }
}

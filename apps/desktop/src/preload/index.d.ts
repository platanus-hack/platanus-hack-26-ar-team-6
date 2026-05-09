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
  cwd?: string
  bootstrap: BootstrapPayload
  userId: string
  chatSessionId?: string
  conversationMessages?: Array<{ role: 'user' | 'assistant'; text: string }>
  mentionedAgentIds?: string[]
  model?: string
  maxTurns?: number
}

type PersistedConversationMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

type PersistedConversation = {
  sessionId: string | null
  messages: PersistedConversationMessage[]
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
        query: string
        scope: 'agent' | 'global'
        target_agent_id?: string
        context_exchange_id?: string
        results: Array<{
          id: string
          kind: string
          content: string
          metadata: Record<string, unknown>
          created_at: unknown
        }>
        insufficient_context: boolean
        summary: string
      }
      errorMessage?: string
    }
  | {
      type: 'memory_update'
      status: 'skipped' | 'succeeded' | 'failed'
      checkpointIndex?: number
      response?: {
        event_ids: string[]
        document_ids: string[]
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

type DesktopSettingsResponse = {
  hasAnthropicApiKey: boolean
  encryptionAvailable: boolean
  serverBaseUrl: string
  isLoggedIn: boolean
  account: DesktopAccountSummary | null
  projects: DesktopProjectMembership[]
  selectedProjectId: string | null
  projectFolders: Record<string, string>
  selectedProjectFolderPath: string | null
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
  | { type: 'project:folder:updated'; settings: DesktopSettingsResponse }

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

type PersistedConversationMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

type PersistedConversation = {
  sessionId: string | null
  messages: PersistedConversationMessage[]
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
  chooseProjectFolder: (projectId: string) => Promise<DesktopSettingsResponse>
  clearProjectFolder: (projectId: string) => Promise<DesktopSettingsResponse>
  createProject: (request: CreateProjectRequest) => Promise<DesktopSettingsResponse>
  deleteProject: (projectId: string) => Promise<DesktopSettingsResponse>
  leaveProject: (projectId: string) => Promise<DesktopSettingsResponse>
  addProjectMember: (request: AddProjectMemberRequest) => Promise<DesktopProjectMembership>
  getBootstrap: () => Promise<BootstrapResponse>
  startAssistantRun: (payload: StartAssistantRunPayload) => Promise<void>
  loadConversation: (workspaceId: string) => Promise<PersistedConversation>
  saveConversation: (workspaceId: string, data: PersistedConversation) => Promise<void>
  clearConversation: (workspaceId: string) => Promise<void>
  onAuthEvent: (callback: (event: AuthEvent) => void) => () => void
  onAssistantEvent: (callback: (event: LocalAssistantEvent) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DesktopApi
  }
}

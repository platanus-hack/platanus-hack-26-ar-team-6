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
      type: 'activity_title'
      title: string
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
  activityGraphEnabled: boolean
  claudeCodeHooksEnabled: boolean
  selectedProjectClaudeHook: ClaudeCodeHookStatus
}

type ClaudeCodeHookStatus = {
  enabled: boolean
  active: boolean
  installed: boolean
  hasSettings: boolean
  hasHookScript: boolean
  hasConfig: boolean
  message: string
}

type ActivityNote = {
  id: string
  date: string
  user: string
  userEmail: string
  project: string
  title: string
  summary: string
  request: string
  wikilinks: string[]
  filesChanged: string[]
  toolsUsed: string[]
  createdAt: string
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
  loadConversation: (workspaceId: string) => Promise<{ sessionId: string | null; messages: Array<{ id: string; role: 'user' | 'assistant'; text: string }> }>
  saveConversation: (workspaceId: string, data: { sessionId: string | null; messages: Array<{ id: string; role: 'user' | 'assistant'; text: string }> }) => Promise<void>
  clearConversation: (workspaceId: string) => Promise<void>
  onAuthEvent: (callback: (event: AuthEvent) => void) => () => void
  onAssistantEvent: (callback: (event: LocalAssistantEvent) => void) => () => void
  toggleActivityGraph: (enabled: boolean) => Promise<DesktopSettingsResponse>
  setClaudeCodeHooksEnabled: (enabled: boolean) => Promise<DesktopSettingsResponse>
  getActivityNotes: (projectFolderPath: string) => Promise<ActivityNote[]>
  loadTeamPulse: (opts?: { bucketSize?: number; bucketCount?: number }) => Promise<TeamPulseResponse>
  refreshTeamPulse: (opts?: { bucketSize?: number; bucketCount?: number }) => Promise<TeamPulseRefreshResult>
  loadResponsibilities: () => Promise<ResponsibilitiesResponse>
  loadProjectGraph: (opts?: {
    includeLocal?: boolean
    maxDocs?: number
    maxEvents?: number
    maxExchanges?: number
  }) => Promise<ProjectGraphResponse>
}

type ProjectGraphNodeKind = 'agent' | 'doc' | 'event'
type ProjectGraphEdgeKind = 'authored' | 'asked' | 'provenance'

type ProjectGraphNode = {
  id: string
  kind: ProjectGraphNodeKind
  label: string
  meta: Record<string, unknown>
}

type ProjectGraphEdge = {
  source: string
  target: string
  kind: ProjectGraphEdgeKind
  weight: number
  meta: Record<string, unknown>
}

type ProjectGraphResponse = {
  project_id: string
  nodes: ProjectGraphNode[]
  edges: ProjectGraphEdge[]
}

type TeamPulseCell = {
  summary: string | null
  event_count: number
  updated_at?: string | null
}

type TeamPulseMember = {
  agent_id: string
  display_name: string
  cells: TeamPulseCell[]
}

type TeamPulseResponse = {
  bucket_size_seconds: number
  bucket_starts: string[]
  members: TeamPulseMember[]
}

type TeamPulseRefreshResult = {
  pulse_doc_ids: string[]
  responsibility_doc_ids: string[]
  skipped_responsibility_agent_ids: string[]
}

type ResponsibilityMember = {
  agent_id: string
  display_name: string
  content: string | null
  updated_at: string | null
  word_count: number | null
}

type ResponsibilitiesResponse = {
  members: ResponsibilityMember[]
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DesktopApi
  }
}

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
  serverUrl: string
  userId: string
  authToken?: string
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
}

interface DesktopApi {
  getHealth: (apiBaseUrl: string) => Promise<HealthResponse>
  getSettings: () => Promise<DesktopSettingsResponse>
  saveAnthropicApiKey: (apiKey: string) => Promise<DesktopSettingsResponse>
  clearAnthropicApiKey: () => Promise<DesktopSettingsResponse>
  getBootstrap: (request: { apiBaseUrl: string; authToken: string; userId: string }) => Promise<BootstrapResponse>
  savePromptAnswer: (request: {
    apiBaseUrl: string
    authToken: string
    prompt: string
    finalAnswer: string
    metadata?: Record<string, unknown>
  }) => Promise<SavePromptAnswerResponse>
  startAssistantRun: (payload: StartAssistantRunPayload) => Promise<void>
  onAssistantEvent: (callback: (event: LocalAssistantEvent) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DesktopApi
  }
}

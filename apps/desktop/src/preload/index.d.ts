import { ElectronAPI } from '@electron-toolkit/preload'

type HealthResponse = {
  status?: string
  sha?: string
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
type LocalRunnerPromptRequest = {
  apiBaseUrl: string
  authToken: string
  cwd: string
  maxTurns?: number
  model?: string
  prompt: string
}

type LocalRunnerPromptResponse = {
  result: string
  messages: unknown[]
}

interface DesktopApi {
  getHealth: (apiBaseUrl: string) => Promise<HealthResponse>
  startAssistantRun: (payload: StartAssistantRunPayload) => Promise<void>
  onAssistantEvent: (callback: (event: LocalAssistantEvent) => void) => () => void
  runAgentPrompt: (request: LocalRunnerPromptRequest) => Promise<LocalRunnerPromptResponse>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DesktopApi
  }
}

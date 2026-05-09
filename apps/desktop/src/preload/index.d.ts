import { ElectronAPI } from '@electron-toolkit/preload'

type HealthResponse = {
  status?: string
  sha?: string
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
  runAgentPrompt: (request: LocalRunnerPromptRequest) => Promise<LocalRunnerPromptResponse>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DesktopApi
  }
}

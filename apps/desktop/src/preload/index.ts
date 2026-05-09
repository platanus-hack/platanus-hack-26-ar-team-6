import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  getHealth: (apiBaseUrl: string) => ipcRenderer.invoke('health:check', apiBaseUrl),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveAnthropicApiKey: (apiKey: string) => ipcRenderer.invoke('settings:anthropic-key:save', apiKey),
  clearAnthropicApiKey: () => ipcRenderer.invoke('settings:anthropic-key:clear'),
  startGoogleLogin: () => ipcRenderer.invoke('auth:login:start'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  refreshProjects: () => ipcRenderer.invoke('auth:projects:refresh'),
  selectProject: (projectId: string) => ipcRenderer.invoke('project:select', projectId),
  createProject: (request: { name: string; description?: string | null; domainSummary?: string | null }) =>
    ipcRenderer.invoke('project:create', request),
  addProjectMember: (request: { projectId: string; email: string; domainSummary: string }) =>
    ipcRenderer.invoke('project:member:add', request),
  getBootstrap: () => ipcRenderer.invoke('bootstrap:load'),
  savePromptAnswer: (request: {
    prompt: string
    finalAnswer: string
    metadata?: Record<string, unknown>
  }) => ipcRenderer.invoke('context-entry:save', request),
  startAssistantRun: (payload: {
    prompt: string
    cwd: string
    bootstrap: unknown
    userId: string
    model?: string
    maxTurns?: number
  }) => ipcRenderer.invoke('assistant:run:start', payload),
  onAuthEvent: (callback: (event: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data)
    ipcRenderer.on('auth:event', listener)

    return () => {
      ipcRenderer.removeListener('auth:event', listener)
    }
  },
  onAssistantEvent: (callback: (event: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data)
    ipcRenderer.on('assistant:event', listener)

    return () => {
      ipcRenderer.removeListener('assistant:event', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

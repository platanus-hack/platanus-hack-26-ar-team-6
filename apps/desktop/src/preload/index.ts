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
  chooseProjectFolder: (projectId: string) => ipcRenderer.invoke('project:folder:choose', projectId),
  clearProjectFolder: (projectId: string) => ipcRenderer.invoke('project:folder:clear', projectId),
  createProject: (request: { name: string; description?: string | null; domainSummary?: string | null }) =>
    ipcRenderer.invoke('project:create', request),
  deleteProject: (projectId: string) => ipcRenderer.invoke('project:delete', projectId),
  addProjectMember: (request: { projectId: string; email: string; domainSummary: string }) =>
    ipcRenderer.invoke('project:member:add', request),
  getBootstrap: () => ipcRenderer.invoke('bootstrap:load'),
  startAssistantRun: (payload: {
    prompt: string
    cwd?: string
    bootstrap: unknown
    userId: string
    chatSessionId?: string
    conversationMessages?: Array<{ role: 'user' | 'assistant'; text: string }>
    model?: string
    maxTurns?: number
  }) => ipcRenderer.invoke('assistant:run:start', payload),
  loadConversation: (workspaceId: string) =>
    ipcRenderer.invoke('conversation:load', workspaceId) as Promise<{
      sessionId: string | null
      messages: Array<{ id: string; role: 'user' | 'assistant'; text: string }>
    }>,
  saveConversation: (
    workspaceId: string,
    data: { sessionId: string | null; messages: Array<{ id: string; role: 'user' | 'assistant'; text: string }> }
  ) => ipcRenderer.invoke('conversation:save', workspaceId, data),
  clearConversation: (workspaceId: string) => ipcRenderer.invoke('conversation:clear', workspaceId),
  toggleActivityGraph: (enabled: boolean) => ipcRenderer.invoke('settings:activity-graph:toggle', enabled),
  getActivityNotes: (projectFolderPath: string) => ipcRenderer.invoke('activity-graph:get-notes', projectFolderPath),
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

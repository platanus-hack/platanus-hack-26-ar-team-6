import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  getHealth: (apiBaseUrl: string) => ipcRenderer.invoke('health:check', apiBaseUrl),
  startAssistantRun: (payload: {
    prompt: string
    cwd: string
    bootstrap: unknown
    serverUrl: string
    userId: string
    authToken?: string
    model?: string
    maxTurns?: number
  }) => ipcRenderer.invoke('assistant:run:start', payload),
  onAssistantEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
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

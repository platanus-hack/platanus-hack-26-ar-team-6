import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { runLocalAssistant } from '../runner.js'
import type { RunLocalAssistantOptions } from '../types.js'
import {
  runLocalAgentPrompt,
  type LocalRunnerPromptRequest,
  type LocalRunnerPromptResponse
} from './local_runner'

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

type BootstrapRequest = {
  apiBaseUrl: string
  authToken: string
  userId: string
}

type SavePromptAnswerRequest = {
  apiBaseUrl: string
  authToken: string
  prompt: string
  finalAnswer: string
  metadata?: Record<string, unknown>
}

type SavePromptAnswerResponse = {
  id: string
  kind: string
}

function normalizeBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, '')
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status} ${response.statusText}: ${text}`)
  }

  return response.json() as Promise<T>
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
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

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
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

  ipcMain.handle('bootstrap:load', async (_, request: BootstrapRequest): Promise<BootstrapResponse> => {
    const normalizedBaseUrl = normalizeBaseUrl(request.apiBaseUrl)
    const bootstrapUrl = new URL(`${normalizedBaseUrl}/bootstrap`)
    bootstrapUrl.searchParams.set('user_id', request.userId)

    return fetchJson<BootstrapResponse>(bootstrapUrl.toString(), {
      headers: {
        Authorization: `Bearer ${request.authToken}`
      }
    })
  })

  ipcMain.handle(
    'context-entry:save',
    async (_, request: SavePromptAnswerRequest): Promise<SavePromptAnswerResponse> => {
      const normalizedBaseUrl = normalizeBaseUrl(request.apiBaseUrl)
      return fetchJson<SavePromptAnswerResponse>(`${normalizedBaseUrl}/context-entries`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${request.authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: request.prompt,
          final_answer: request.finalAnswer,
          metadata: request.metadata ?? {}
        })
      })
    }
  )

  ipcMain.handle('assistant:run:start', async (event, payload: RunLocalAssistantOptions): Promise<void> => {
    for await (const assistantEvent of runLocalAssistant(payload)) {
      event.sender.send('assistant:event', assistantEvent)
    }
  })

  ipcMain.handle(
    'runner:query',
    async (_, request: LocalRunnerPromptRequest): Promise<LocalRunnerPromptResponse> => {
      return runLocalAgentPrompt(request)
    }
  )

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

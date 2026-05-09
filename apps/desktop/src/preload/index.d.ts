import { ElectronAPI } from '@electron-toolkit/preload'

type HealthResponse = {
  status?: string
  sha?: string
}

interface DesktopApi {
  getHealth: (apiBaseUrl: string) => Promise<HealthResponse>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DesktopApi
  }
}

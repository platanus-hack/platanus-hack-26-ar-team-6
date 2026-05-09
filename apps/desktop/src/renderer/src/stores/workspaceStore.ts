import { create } from 'zustand'
import type { TabKey } from '../components/Tabs'

type Workspace = {
  id: string
  name: string
}

type WorkspaceState = {
  workspaces: Workspace[]
  currentWorkspaceId: string | null
  activeTabByWorkspace: Record<string, TabKey>
  createWorkspace: (workspaceName: string) => void
  openWorkspace: (workspaceId: string) => void
  goHome: () => void
  setWorkspaceTab: (workspaceId: string, tab: TabKey) => void
}

const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  currentWorkspaceId: null,
  activeTabByWorkspace: {},
  createWorkspace: (workspaceName) =>
    set((state) => {
      const trimmedName = workspaceName.trim()

      if (!trimmedName) {
        return state
      }

      const workspaceId = `${Date.now()}-${trimmedName.toLowerCase().replace(/\s+/g, '-')}`

      return {
        workspaces: [...state.workspaces, { id: workspaceId, name: trimmedName }],
        currentWorkspaceId: workspaceId,
        activeTabByWorkspace: {
          ...state.activeTabByWorkspace,
          [workspaceId]: 'chat'
        }
      }
    }),
  openWorkspace: (workspaceId) => set({ currentWorkspaceId: workspaceId }),
  goHome: () => set({ currentWorkspaceId: null }),
  setWorkspaceTab: (workspaceId, tab) =>
    set((state) => ({
      activeTabByWorkspace: {
        ...state.activeTabByWorkspace,
        [workspaceId]: tab
      }
    }))
}))

export type { Workspace, WorkspaceState }
export default useWorkspaceStore

import { create } from 'zustand'

type WorkspaceState = {
  workspaceName: string
  setWorkspaceName: (workspaceName: string) => void
}

const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaceName: 'demo',
  setWorkspaceName: (workspaceName) => set({ workspaceName })
}))

export type { WorkspaceState }
export default useWorkspaceStore

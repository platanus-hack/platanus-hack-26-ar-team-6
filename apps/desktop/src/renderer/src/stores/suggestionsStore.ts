import { create } from 'zustand'

export type TaskSuggestion = {
  id: string
  title: string
  priority: 'high' | 'medium' | 'low'
  context: string
}

export type SuggestionsPhase =
  | { kind: 'hidden' }
  | { kind: 'generating'; progressMessages: string[] }
  | { kind: 'visible'; suggestions: TaskSuggestion[] }
  | { kind: 'error'; message: string }

type SuggestionsState = {
  phaseByProject: Record<string, SuggestionsPhase>
  setPhase: (projectId: string, phase: SuggestionsPhase) => void
  addProgressMessage: (projectId: string, message: string) => void
}

const useSuggestionsStore = create<SuggestionsState>((set) => ({
  phaseByProject: {},
  setPhase: (projectId, phase) =>
    set((s) => ({ phaseByProject: { ...s.phaseByProject, [projectId]: phase } })),
  addProgressMessage: (projectId, message) =>
    set((s) => {
      const prev = s.phaseByProject[projectId]
      if (prev?.kind !== 'generating') return s
      return {
        phaseByProject: {
          ...s.phaseByProject,
          [projectId]: { ...prev, progressMessages: [...prev.progressMessages, message] },
        },
      }
    }),
}))

// Kept outside the store so subscriptions survive component unmounts
export const activeSubscriptions = new Map<string, () => void>()

export default useSuggestionsStore

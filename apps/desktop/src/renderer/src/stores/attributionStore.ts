import { create } from 'zustand'

type AttributionState = {
  selectedMemoryId: string | null
  setSelectedMemoryId: (selectedMemoryId: string | null) => void
}

const useAttributionStore = create<AttributionState>((set) => ({
  selectedMemoryId: null,
  setSelectedMemoryId: (selectedMemoryId) => set({ selectedMemoryId })
}))

export type { AttributionState }
export default useAttributionStore

import { create } from 'zustand'
import { listCommunities, getCommunityById } from '../lib/verifier'
import type { CommunityConfig } from '../types'

interface CommunityStore {
  communities: CommunityConfig[]
  loading: boolean
  error: string | null
  fetchAll: () => Promise<void>
  fetchOne: (id: string) => Promise<CommunityConfig | null>
}

export const useCommunityStore = create<CommunityStore>((set) => ({
  communities: [],
  loading: false,
  error: null,

  fetchAll: async () => {
    set({ loading: true, error: null })
    try {
      const communities = await listCommunities()
      set({ communities, loading: false })
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  fetchOne: async (id: string) => {
    try {
      return await getCommunityById(id)
    } catch {
      return null
    }
  },
}))

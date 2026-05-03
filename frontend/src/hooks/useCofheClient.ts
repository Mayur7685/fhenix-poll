import { useEffect } from 'react'
import { usePublicClient, useWalletClient } from 'wagmi'
import { create } from 'zustand'
import { cofheClient } from '../lib/cofhe'

interface CofheStore { isReady: boolean; isLoading: boolean; error: string | null }

export const useCofheStore = create<CofheStore>(() => ({
  isReady: false, isLoading: false, error: null,
}))

let _initPromise: Promise<void> | null = null

export function useCofheClient() {
  const publicClient           = usePublicClient()
  const { data: walletClient } = useWalletClient()

  useEffect(() => {
    if (!publicClient || !walletClient) return
    if (useCofheStore.getState().isReady || _initPromise) return

    useCofheStore.setState({ isLoading: true, error: null })
    _initPromise = cofheClient
      .connect(publicClient, walletClient)
      .then(() => useCofheStore.setState({ isReady: true, isLoading: false }))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'CoFHE init failed'
        useCofheStore.setState({ error: msg, isLoading: false })
      })
      .finally(() => { _initPromise = null })
  }, [publicClient, walletClient])

  return { cofheClient, ...useCofheStore() }
}

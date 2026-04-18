// EVM wallet hook — CofheProvider (in main.tsx) handles client init; this is just account state.

import { useConnection, useConnect, useDisconnect } from 'wagmi'

export function useWallet() {
  const { address, isConnected, chainId } = useConnection()
  const { connect, connectors }           = useConnect()
  const { disconnect }                    = useDisconnect()

  return {
    address:    address ?? null,
    isConnected,
    chainId,
    connect,
    disconnect,
    connectors,
  }
}

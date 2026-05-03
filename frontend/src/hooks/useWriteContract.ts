// Drop-in replacement for useCofheWriteContract from @cofhe/react.
// Uses wagmi walletClient directly — no iframe, no CofheProvider needed.
import { useCallback } from 'react'
import { useWalletClient } from 'wagmi'
import type { Abi, ContractFunctionName, ContractFunctionArgs } from 'viem'

export function useWriteContract() {
  const { data: walletClient } = useWalletClient()

  const writeContractAsync = useCallback(async (params: {
    chain?: unknown
    account?: `0x${string}`
    address: `0x${string}`
    abi: Abi
    functionName: string
    args?: unknown[]
    [key: string]: unknown
  }): Promise<`0x${string}`> => {
    if (!walletClient) throw new Error('Wallet not connected')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (walletClient.writeContract as any)(params)
  }, [walletClient])

  return { writeContractAsync }
}

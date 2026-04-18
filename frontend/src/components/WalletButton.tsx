import { useState } from 'react'
import { useConnection, useConnect, useDisconnect } from 'wagmi'
import { arbitrumSepolia, localCofhe } from '../lib/chains'

const REQUIRED_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? arbitrumSepolia.id)
const CHAIN_NAMES: Record<number, string> = {
  [arbitrumSepolia.id]: 'Arbitrum Sepolia',
  [localCofhe.id]:      'LocalCofhe',
}
// Arbitrum Sepolia — chainId 421614 = 0x66eee
const ADD_CHAIN_PARAMS: Record<number, object> = {
  [arbitrumSepolia.id]: {
    chainId:           '0x66eee',
    chainName:         'Arbitrum Sepolia',
    nativeCurrency:    { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls:           ['https://sepolia-rollup.arbitrum.io/rpc'],
    blockExplorerUrls: ['https://sepolia.arbiscan.io'],
  },
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export default function WalletButton() {
  const { address, isConnected, chainId }  = useConnection()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect }                     = useDisconnect()
  const [switching, setSwitching]          = useState(false)

  const handleSwitch = async () => {
    const eth = (window as Window & { ethereum?: { request: (a: object) => Promise<unknown> } }).ethereum
    if (!eth) return
    setSwitching(true)
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x66eee' }] })
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 4902) {
        const addParams = ADD_CHAIN_PARAMS[REQUIRED_CHAIN_ID]
        if (addParams) {
          try { await eth.request({ method: 'wallet_addEthereumChain', params: [addParams] }) }
          catch { /* user rejected */ }
        }
      }
    }
    setSwitching(false)
  }

  // Connected but wrong network
  if (isConnected && chainId !== REQUIRED_CHAIN_ID) {
    const requiredName = CHAIN_NAMES[REQUIRED_CHAIN_ID] ?? `Chain ${REQUIRED_CHAIN_ID}`
    return (
      <button
        disabled={switching}
        onClick={handleSwitch}
        className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-full bg-amber-500 hover:bg-amber-600 text-white transition-colors disabled:opacity-60"
      >
        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        {switching ? 'Switching…' : `Switch to ${requiredName}`}
      </button>
    )
  }

  // Connected, correct network
  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnect()}
        className="text-sm font-medium px-4 py-2 rounded-full border border-gray-200 hover:bg-gray-100 text-gray-700 transition-colors"
      >
        {shortAddr(address)}
      </button>
    )
  }

  // Disconnected
  return (
    <button
      disabled={isPending || connectors.length === 0}
      onClick={() => connect({ connector: connectors[0] })}
      className="text-sm font-medium px-4 py-2 rounded-full bg-gray-900 hover:bg-gray-800 text-white transition-colors disabled:opacity-50"
    >
      {isPending ? 'Connecting…' : 'Connect Wallet'}
    </button>
  )
}

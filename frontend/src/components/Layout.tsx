import { useState } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import WalletButton from './WalletButton'
import { useConnection } from 'wagmi'
import { arbitrumSepolia, localCofhe } from '../lib/chains'


// Chains the app supports — keyed by chainId
const SUPPORTED: Record<number, { name: string }> = {
  [arbitrumSepolia.id]: { name: 'Arbitrum Sepolia' },
  [localCofhe.id]:      { name: 'LocalCofhe' },
}

// The chain the contract is deployed on (from env, default Arbitrum Sepolia)
const REQUIRED_CHAIN_ID   = Number(import.meta.env.VITE_CHAIN_ID ?? arbitrumSepolia.id)
const REQUIRED_CHAIN_NAME = SUPPORTED[REQUIRED_CHAIN_ID]?.name ?? `Chain ${REQUIRED_CHAIN_ID}`

// Chain params for wallet_addEthereumChain (error 4902 — chain not in MetaMask yet)
const ADD_CHAIN_PARAMS: Record<number, object> = {
  // Arbitrum Sepolia — chainId 421614 = 0x66eee
  [arbitrumSepolia.id]: {
    chainId:           '0x66eee',
    chainName:         'Arbitrum Sepolia',
    nativeCurrency:    { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls:           ['https://sepolia-rollup.arbitrum.io/rpc'],
    blockExplorerUrls: ['https://sepolia.arbiscan.io'],
  },
}

function WrongNetworkBanner() {
  const { isConnected, chainId } = useConnection()
  const [switching, setSwitching] = useState(false)

  if (!isConnected || chainId === REQUIRED_CHAIN_ID) return null

  const currentName = chainId ? (SUPPORTED[chainId]?.name ?? `Chain ${chainId}`) : 'Unknown'

  const handleSwitch = async () => {
    const eth = (window as Window & { ethereum?: { request: (a: object) => Promise<unknown> } }).ethereum
    if (!eth) return
    setSwitching(true)
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x66eee' }] })
    } catch (err: unknown) {
      // 4902 = chain not added to wallet yet — add it first
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

  return (
    <div className="w-full bg-amber-50 border-b border-amber-200">
      <div className="max-w-[1400px] mx-auto px-6 sm:px-8 py-2.5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-amber-800">
          <svg className="w-4 h-4 shrink-0 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="12" y1="9" x2="12" y2="13" strokeLinecap="round"/>
            <line x1="12" y1="17" x2="12.01" y2="17" strokeLinecap="round"/>
          </svg>
          <span>
            Wrong network — connected to <strong>{currentName}</strong>,
            app requires <strong>{REQUIRED_CHAIN_NAME}</strong>
          </span>
        </div>
        <button
          disabled={switching}
          onClick={handleSwitch}
          className="text-xs font-semibold px-3 py-1.5 rounded-full bg-amber-800 hover:bg-amber-900 text-white transition-colors disabled:opacity-60 shrink-0"
        >
          {switching ? 'Switching…' : `Switch to ${REQUIRED_CHAIN_NAME}`}
        </button>
      </div>
    </div>
  )
}

const NAV = [
  { to: '/polls',       label: 'Polls' },
  { to: '/communities', label: 'Communities' },
  { to: '/my-votes',    label: 'My Votes' },
  { to: '/credentials', label: 'Credentials' },
]

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { pathname } = useLocation()
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">

      {/* Top decorative bar */}
      <div className="w-full px-8 pt-4">
        <div className="h-1 w-full bg-gray-900 rounded-sm max-w-[1400px] mx-auto" />
      </div>

      {/* Header */}
      <header className="w-full max-w-[1400px] mx-auto px-6 sm:px-8 py-4 flex items-center justify-between gap-4">

        {/* Logo */}
        <Link
          to="/polls"
          className="flex items-center shrink-0"
          onClick={() => setMenuOpen(false)}
        >
          <span className="text-xl font-semibold tracking-tight text-gray-900 leading-none">FhenixPoll</span>
        </Link>

        {/* Center nav — desktop */}
        <nav className="hidden sm:flex items-center space-x-6 sm:space-x-8">
          {NAV.map(n => {
            const active = pathname === n.to || pathname.startsWith(n.to)
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`text-sm font-medium transition-colors pb-0.5 ${
                  active
                    ? 'text-gray-900 border-b-2 border-gray-900'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {n.label}
              </Link>
            )
          })}
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-3">
          {/* + New Poll */}
          <button
            onClick={() => navigate('/create-poll')}
            className="hidden sm:flex w-8 h-8 rounded-full bg-gray-900 text-white items-center justify-center hover:bg-gray-800 transition-colors shrink-0"
            title="Create Poll"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" strokeLinecap="round"/>
            </svg>
          </button>

          {/* Wallet button */}
          <WalletButton />

          {/* Hamburger — mobile */}
          <button
            className="sm:hidden flex flex-col gap-1.5 p-1.5"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Toggle menu"
          >
            <span className={`block w-5 h-0.5 bg-gray-900 transition-all ${menuOpen ? 'rotate-45 translate-y-2' : ''}`} />
            <span className={`block w-5 h-0.5 bg-gray-900 transition-all ${menuOpen ? 'opacity-0' : ''}`} />
            <span className={`block w-5 h-0.5 bg-gray-900 transition-all ${menuOpen ? '-rotate-45 -translate-y-2' : ''}`} />
          </button>
        </div>
      </header>

      {/* Mobile nav dropdown */}
      {menuOpen && (
        <nav className="sm:hidden bg-white border-b border-gray-100 px-6 pb-4 flex flex-col gap-1">
          {NAV.map(n => {
            const active = pathname === n.to || pathname.startsWith(n.to)
            return (
              <Link
                key={n.to}
                to={n.to}
                onClick={() => setMenuOpen(false)}
                className={`text-sm font-medium py-2.5 border-b border-gray-50 last:border-0 ${
                  active ? 'text-gray-900' : 'text-gray-500'
                }`}
              >
                {n.label}
              </Link>
            )
          })}
          <Link
            to="/my-votes"
            onClick={() => setMenuOpen(false)}
            className="text-sm font-medium py-2.5 text-gray-500"
          >
            My Votes
          </Link>
          <Link
            to="/credentials"
            onClick={() => setMenuOpen(false)}
            className="text-sm font-medium py-2.5 text-[#0070F3]"
          >
            Credentials Hub
          </Link>
          <Link
            to="/create-poll"
            onClick={() => setMenuOpen(false)}
            className="text-sm font-medium py-2.5 text-gray-500"
          >
            + New Poll
          </Link>
          <Link
            to="/create"
            onClick={() => setMenuOpen(false)}
            className="text-sm font-medium py-2.5 text-gray-500"
          >
            + New Community
          </Link>
        </nav>
      )}

      {/* Wrong-network banner */}
      <WrongNetworkBanner />

      {/* Page content */}
      <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-8 py-8">
        <Outlet />
      </main>
    </div>
  )
}

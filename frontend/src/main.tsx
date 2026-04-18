import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { WagmiProvider, http, createConfig, injected } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CofheProvider, createCofheConfig } from '@cofhe/react'
import { hardhat as cofheHardhat, localcofhe as cofheLocalcofhe, arbSepolia as cofheArbSepolia } from '@cofhe/sdk/chains'
import { usePublicClient, useWalletClient } from 'wagmi'

import { arbitrumSepolia, localCofhe } from './lib/chains'
import App from './App.tsx'
import { ToastProvider } from './components/Toast.tsx'
import OnboardingTutorial from './components/OnboardingTutorial.tsx'
import './index.css'

// ─── Wagmi config (injected only — no RainbowKit / MetaMask SDK) ──────────────

const wagmiConfig = createConfig({
  chains:     [localCofhe, arbitrumSepolia],
  connectors: [injected()],
  transports: {
    [localCofhe.id]:       http(import.meta.env.VITE_RPC_URL ?? 'http://127.0.0.1:8545'),
    [arbitrumSepolia.id]:  http(import.meta.env.VITE_RPC_URL ?? 'https://sepolia-rollup.arbitrum.io/rpc'),
  },
})

// ─── Cofhe config ─────────────────────────────────────────────────────────────

const cofheConfig = createCofheConfig({
  environment:     'react',
  supportedChains: [cofheHardhat, cofheLocalcofhe, cofheArbSepolia],
  react: {
    enableShieldUnshield:  false,
    autogeneratePermits:   true,
    shareablePermits:      false,
    position:              'bottom-right',
  },
})

// ─── CofheWalletBridge — passes wagmi clients to CofheProvider ───────────────

function CofheWalletBridge({ children }: { children: React.ReactNode }) {
  const publicClient           = usePublicClient()
  const { data: walletClient } = useWalletClient()

  return (
    <CofheProvider
      config={cofheConfig}
      publicClient={publicClient}
      walletClient={walletClient}
    >
      {children}
    </CofheProvider>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
      <QueryClientProvider client={queryClient}>
        <CofheWalletBridge>
          {children}
        </CofheWalletBridge>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Providers>
        <ToastProvider>
          <App />
          <OnboardingTutorial />
        </ToastProvider>
      </Providers>
    </BrowserRouter>
  </React.StrictMode>,
)

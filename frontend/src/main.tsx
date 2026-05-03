import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { WagmiProvider, http, createConfig, injected } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { arbitrumSepolia, localCofhe } from './lib/chains'
import App from './App.tsx'
import { ToastProvider } from './components/Toast.tsx'
import OnboardingTutorial from './components/OnboardingTutorial.tsx'
import './index.css'

const wagmiConfig = createConfig({
  chains:     [localCofhe, arbitrumSepolia],
  connectors: [injected()],
  transports: {
    [localCofhe.id]:      http(import.meta.env.VITE_RPC_URL ?? 'http://127.0.0.1:8545'),
    [arbitrumSepolia.id]: http(import.meta.env.VITE_RPC_URL ?? 'https://sepolia-rollup.arbitrum.io/rpc'),
  },
})

function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Providers>
      <ToastProvider>
        <App />
        <OnboardingTutorial />
      </ToastProvider>
    </Providers>
  </BrowserRouter>,
)

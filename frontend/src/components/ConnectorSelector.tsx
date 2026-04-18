// ConnectorSelector — lets users connect their social accounts before verification.
//
// OAuth popup flow (Twitter, Discord, GitHub) mirrors Guild.xyz's approach:
//   1. Open a centered popup to /api/auth/{provider}
//   2. Listen on a BroadcastChannel named "zkpoll-{provider}"
//   3. The popup's callback page posts { status, userId, username } to the channel and closes
//   4. Main window receives the message, updates state, closes channel
//
// Telegram uses a full-tab redirect (same as Guild) because Telegram's login
// widget doesn't function inside a popup window.

import { useState } from 'react'
import { useConnection, useSignMessage } from 'wagmi'
import type { ConnectedAccount } from '../types'

interface Props {
  accounts: ConnectedAccount[]
  onChange: (accounts: ConnectedAccount[]) => void
}

type ConnectorType = 'EVM_WALLET' | 'X_TWITTER' | 'DISCORD' | 'GITHUB' | 'TELEGRAM'

const CONNECTORS: ConnectorMeta[] = [
  { type: 'EVM_WALLET', icon: '/MetaMask-icon-fox.svg',        name: 'EVM Wallet',   hint: 'MetaMask, Coinbase, etc.' },
  { type: 'X_TWITTER',  icon: '/x-icon.svg',                  name: 'X / Twitter',  hint: 'Required for follow checks' },
  { type: 'DISCORD',    icon: '/Discord-Symbol-Blurple.svg',   name: 'Discord',      hint: 'Required for server/role checks' },
  { type: 'GITHUB',     icon: '/GitHub_Invertocat_Black.svg',  name: 'GitHub',       hint: 'Required for repo/commit checks' },
  { type: 'TELEGRAM',   icon: '/telegram-icon.svg',            name: 'Telegram',     hint: 'Required for channel checks', beta: true },
]

type ConnectorMeta = { type: ConnectorType; icon: string; name: string; hint: string; beta?: boolean }

// Channel names must match what the verifier's popup HTML uses (popupSuccess calls in index.ts)
const CHANNELS: Partial<Record<ConnectorType, string>> = {
  X_TWITTER: 'fhenixpoll-twitter',
  DISCORD:   'fhenixpoll-discord',
  GITHUB:    'fhenixpoll-github',
  TELEGRAM:  'fhenixpoll-telegram',
}

const VERIFIER = import.meta.env.VITE_VERIFIER_URL ?? '/api'

const ROUTES: Partial<Record<ConnectorType, string>> = {
  X_TWITTER: `${VERIFIER}/auth/twitter`,
  DISCORD:   `${VERIFIER}/auth/discord`,
  GITHUB:    `${VERIFIER}/auth/github`,
  TELEGRAM:  `${VERIFIER}/auth/telegram`,
}

/** Open a centered popup and resolve when the BroadcastChannel or postMessage fires. */
function oauthPopup(
  url: string,
  channelName: string,
): Promise<{ userId: string; username: string }> {
  return new Promise((resolve, reject) => {
    const w = 520, h = 680
    const left = Math.round(window.screenX + (window.outerWidth - w) / 2)
    const top  = Math.round(window.screenY + (window.outerHeight - h) / 2)
    const popup = window.open(url, channelName, `width=${w},height=${h},left=${left},top=${top},scrollbars=yes`)
    if (!popup) { reject(new Error('Popup blocked — allow popups for this site')); return }

    let settled = false
    const channel = new BroadcastChannel(channelName)

    const cleanup = () => {
      channel.close()
      window.removeEventListener('message', onMessage)
      clearInterval(closedPoll)
    }

    const handle = (data: Record<string, string>) => {
      if (settled) return
      settled = true
      cleanup()
      if (data?.status === 'success') {
        resolve({ userId: data.userId, username: data.username })
      } else {
        reject(new Error(data?.message ?? 'OAuth failed'))
      }
    }

    // Same-origin: BroadcastChannel
    channel.onmessage = (e) => handle(e.data)

    // Cross-origin: window.postMessage
    const onMessage = (e: MessageEvent) => {
      if (e.data?.channel === channelName) handle(e.data)
    }
    window.addEventListener('message', onMessage)

    const closedPoll = setInterval(() => {
      if (popup.closed && !settled) { cleanup(); reject(new Error('Popup closed')) }
    }, 600)
  })
}

export default function ConnectorSelector({ accounts, onChange }: Props) {
  const [evmError, setEvmError]     = useState<string | null>(null)
  const [connecting, setConnecting] = useState<ConnectorType | null>(null)
  const [oauthError, setOauthError] = useState<string | null>(null)

  const { address: wagmiAddress } = useConnection()
  const { signMessageAsync }      = useSignMessage()

  const get = (type: ConnectorType) => accounts.find(a => a.type === type)

  const connectEVM = async () => {
    setEvmError(null)
    if (!wagmiAddress) { setEvmError('Connect wallet via the button in the top-right first.'); return }
    try {
      setConnecting('EVM_WALLET')
      const address = wagmiAddress

      // Request a challenge from the verifier
      const BASE = import.meta.env.VITE_VERIFIER_URL ?? '/api'
      const { challenge } = await fetch(`${BASE}/auth/evm/challenge?address=${address}`)
        .then(r => r.json()) as { challenge: string }

      // Sign challenge using wagmi — works with any connected EVM wallet
      const signature = await signMessageAsync({ account: address, message: challenge })

      // Verify signature server-side
      const { verified } = await fetch(`${BASE}/auth/evm/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, challenge, signature }),
      }).then(r => r.json()) as { verified: boolean }

      if (!verified) throw new Error('Signature verification failed')

      onChange([
        ...accounts.filter(a => a.type !== 'EVM_WALLET'),
        { type: 'EVM_WALLET', identifier: address, displayName: `${address.slice(0, 6)}…${address.slice(-4)}` },
      ])
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!msg.toLowerCase().includes('user rejected') && msg !== 'Popup closed') {
        setEvmError(msg)
      }
    } finally {
      setConnecting(null)
    }
  }

  const handleConnect = async (type: ConnectorType) => {
    setOauthError(null)
    if (type === 'EVM_WALLET') { void connectEVM(); return }

    const route   = ROUTES[type]!
    const channel = CHANNELS[type]!

    // Telegram can't run in a popup — redirect the current tab (Guild's approach)
    if (type === 'TELEGRAM') {
      window.location.href = route
      return
    }

    setConnecting(type)
    try {
      const { userId, username } = await oauthPopup(route, channel)
      const displayName = type === 'X_TWITTER' ? `@${username}` : username
      onChange([
        ...accounts.filter(a => a.type !== type),
        { type, identifier: userId, displayName },
      ])
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg !== 'Popup closed') setOauthError(msg)
    } finally {
      setConnecting(null)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Connected Accounts</p>

      {CONNECTORS.map(({ type, icon, name, hint, beta }) => {
        const account      = get(type)
        const isConnecting = connecting === type

        return (
          <div key={type} className="flex items-center justify-between p-3 bg-gray-50 border border-gray-100 rounded-xl">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 flex items-center justify-center shrink-0">
                <img
                  src={icon}
                  alt={name}
                  className={`w-5 h-5 object-contain ${type === 'X_TWITTER' ? 'invert' : ''}`}
                />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-gray-800">{name}</span>
                  {beta && <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full font-medium">Beta</span>}
                </div>
                <div className="text-xs text-gray-400 truncate max-w-[160px]">
                  {account ? (account.displayName ?? account.identifier) : hint}
                </div>
              </div>
            </div>

            {account ? (
              <button
                onClick={() => onChange(accounts.filter(a => a.type !== type))}
                className="text-xs text-gray-500 hover:text-red-500 border border-gray-200 hover:border-red-200 px-3 py-1.5 rounded-lg transition-colors shrink-0"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={() => void handleConnect(type)}
                disabled={isConnecting}
                className="text-xs font-medium text-[#0070F3] border border-blue-200 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
              >
                {isConnecting && (
                  <span className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                )}
                Connect
              </button>
            )}
          </div>
        )
      })}

      {evmError && (
        <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{evmError}</p>
      )}
      {oauthError && (
        <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{oauthError}</p>
      )}
    </div>
  )
}

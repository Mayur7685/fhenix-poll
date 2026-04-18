// Step 41 — Toast notification system.
// Usage: import { useToast } from './Toast' — call toast.success() / toast.error()
// Wrap app with <ToastProvider> in main.tsx.

import { createContext, useContext, useState, useCallback, useRef } from 'react'

interface ToastItem {
  id: number
  type: 'success' | 'error' | 'info'
  message: string
  txId?: string   // links to Fhenix explorer
}

interface ToastContextValue {
  success: (message: string, txId?: string) => void
  error:   (message: string) => void
  info:    (message: string) => void
}

const ToastContext = createContext<ToastContextValue>({
  success: () => {},
  error:   () => {},
  info:    () => {},
})

export function useToast() {
  return useContext(ToastContext)
}

const EXPLORER_TX = (txHash: string) =>
  `https://sepolia.arbiscan.io/tx/${txHash}`

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts]   = useState<ToastItem[]>([])
  const counterRef            = useRef(0)

  const push = useCallback((type: ToastItem['type'], message: string, txId?: string) => {
    const id = ++counterRef.current
    setToasts(prev => [...prev, { id, type, message, txId }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
  }, [])

  const ctx: ToastContextValue = {
    success: (msg, txId) => push('success', msg, txId),
    error:   (msg)       => push('error', msg),
    info:    (msg)       => push('info', msg),
  }

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span className="toast-icon">
              {t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ'}
            </span>
            <span className="toast-message">{t.message}</span>
            {t.txId && (
              <a
                href={EXPLORER_TX(t.txId)}
                target="_blank"
                rel="noopener noreferrer"
                className="toast-link"
              >
                View tx ↗
              </a>
            )}
            <button
              className="toast-close"
              onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

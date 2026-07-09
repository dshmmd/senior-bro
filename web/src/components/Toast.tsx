// App-wide feedback toasts (RF-5). Replaces silently swallowed errors: any failed
// mutation/load surfaces here instead of doing nothing. Kept dependency-free.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

export type ToastKind = 'error' | 'success' | 'info'

interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

interface ToastApi {
  push: (kind: ToastKind, message: string) => void
  /** Convenience: toast an unknown error (Error or string) — the standard catch handler. */
  error: (err: unknown) => void
  success: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

const TOAST_MS = 5000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++
    setToasts((ts) => [...ts.slice(-3), { id, kind, message }])
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), TOAST_MS)
  }, [])

  const apiRef = useRef<ToastApi>({
    push,
    error: (err) => push('error', err instanceof Error ? err.message : String(err)),
    success: (m) => push('success', m),
    info: (m) => push('info', m),
  })

  return (
    <ToastContext.Provider value={apiRef.current}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.kind}`}
            onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}
          >
            {t.kind === 'error' ? '⚠ ' : t.kind === 'success' ? '✓ ' : ''}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

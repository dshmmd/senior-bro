// Promise-based confirm dialog (RF-5) — replaces window.confirm for destructive
// actions so they get a styled, accessible dialog with an explicit danger action.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

export interface ConfirmOptions {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return ctx
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<(ok: boolean) => void>(() => undefined)

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const close = (ok: boolean) => {
    setOpts(null)
    resolver.current(ok)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <div className="dialog-overlay" onClick={() => close(false)}>
          <div
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-label={opts.title}
            onClick={(e) => e.stopPropagation()}
          >
            <b>{opts.title}</b>
            {opts.body && <p style={{ color: 'var(--muted)', fontSize: 14 }}>{opts.body}</p>}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="secondary" autoFocus onClick={() => close(false)}>
                {opts.cancelLabel ?? 'Cancel'}
              </button>
              <button className={opts.danger ? 'danger' : ''} onClick={() => close(true)}>
                {opts.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

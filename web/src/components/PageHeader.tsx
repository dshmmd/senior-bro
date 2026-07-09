// Standard page header (RF-6): title on the left, actions (e.g. Back) on the right.
import type { ReactNode } from 'react'

export function PageHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="between">
      <h1 style={{ margin: '12px 0' }}>{title}</h1>
      {actions && <div className="row">{actions}</div>}
    </div>
  )
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="card">
      <span className="muted">{children}</span>
      {action && <div className="mt">{action}</div>}
    </div>
  )
}

// Card primitives (RF-6). `NavCard` is the keyboard-accessible replacement for the
// old `div.card.clickable` pattern (real button semantics, arrow affordance).
import type { ReactNode } from 'react'
import { Icon } from './Icon'

export function Card({
  children,
  accent = false,
  className = '',
}: {
  children: ReactNode
  accent?: boolean
  className?: string
}) {
  return (
    <div className={`card ${className}`} style={accent ? { borderColor: 'var(--accent)' } : undefined}>
      {children}
    </div>
  )
}

/** A whole-card navigation action: title + hint, arrow affordance, keyboard-activatable. */
export function NavCard({
  title,
  hint,
  onClick,
  accent = false,
  disabled = false,
}: {
  title: ReactNode
  hint?: ReactNode
  onClick: () => void
  accent?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="card clickable navcard"
      style={accent ? { borderColor: 'var(--accent)' } : undefined}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="navcard-body">
        <b>{title}</b>
        {hint && <span className="muted fs-md">{hint}</span>}
      </span>
      <span className="navcard-arrow" aria-hidden="true">
        <Icon name="arrowRight" size={18} />
      </span>
    </button>
  )
}

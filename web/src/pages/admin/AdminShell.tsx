// Admin console chrome (RF-9 slice 2): title + section tabs. Each admin page
// wraps itself in this shell; tabs are real links (URLs, deep-linkable).
import type { ReactNode } from 'react'
import { NavLink } from 'react-router'

const SECTIONS = [
  { path: '/admin', label: 'Overview' },
  { path: '/admin/models', label: 'Models & keys' },
  { path: '/admin/features', label: 'Feature routing' },
  { path: '/admin/prompts', label: 'Prompts' },
  { path: '/admin/packs', label: 'Company packs' },
  { path: '/admin/users', label: 'Users' },
  { path: '/admin/invites', label: 'Invites' },
  { path: '/admin/usage', label: 'Usage audit' },
  { path: '/admin/audit', label: 'Admin log' },
] as const

export function AdminShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h1 style={{ marginBottom: 4 }}>Admin · {title}</h1>
      <nav className="admin-tabs" aria-label="Admin sections">
        {SECTIONS.map((s) => (
          <NavLink
            key={s.path}
            to={s.path}
            end={s.path === '/admin'}
            className={({ isActive }) => `admin-tab${isActive ? ' active' : ''}`}
          >
            {s.label}
          </NavLink>
        ))}
      </nav>
      {children}
    </>
  )
}

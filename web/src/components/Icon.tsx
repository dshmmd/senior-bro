// Tiny inline SVG icon set (RF-6): replaces emoji-as-iconography in chrome/nav.
// Emoji remain where they're *content* (medals, celebration copy) — never as UI controls.
// All icons are 16×16 stroke icons inheriting currentColor.
import type { ReactNode } from 'react'

const PATHS: Record<string, ReactNode> = {
  wallet: (
    <>
      <rect x="2" y="4" width="12" height="9" rx="2" />
      <path d="M2 7h12M10.5 10.5h1" />
    </>
  ),
  brain: (
    <>
      <path d="M8 2.5a2.5 2.5 0 0 0-2.5 2.5c-1.5.3-2.5 1.4-2.5 3s1 2.7 2.5 3A2.5 2.5 0 0 0 8 13.5" />
      <path d="M8 2.5a2.5 2.5 0 0 1 2.5 2.5c1.5.3 2.5 1.4 2.5 3s-1 2.7-2.5 3A2.5 2.5 0 0 1 8 13.5" />
      <path d="M8 2.5v11" />
    </>
  ),
  tools: (
    <>
      <path d="M9.5 3.5a3 3 0 0 0-4 4l-3 3a1.4 1.4 0 0 0 2 2l3-3a3 3 0 0 0 4-4l-2 2-2-2 2-2Z" />
    </>
  ),
  gear: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4" />
    </>
  ),
  exit: (
    <>
      <path d="M6 2.5H3.5v11H6" />
      <path d="M10 5l3 3-3 3M13 8H6.5" />
    </>
  ),
  back: <path d="M9.5 3.5 5 8l4.5 4.5" />,
  arrowRight: <path d="M6.5 3.5 11 8l-4.5 4.5" />,
  mic: (
    <>
      <rect x="6" y="2" width="4" height="7" rx="2" />
      <path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5V14" />
    </>
  ),
  chat: <path d="M2.5 3.5h11v7h-6l-3 3v-3h-2v-7Z" />,
}

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, verticalAlign: '-2px' }}
    >
      {PATHS[name]}
    </svg>
  )
}

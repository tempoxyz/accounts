export type Mode = 'iframe' | 'popup' | 'standalone'

/** Derives the rendering mode from search params and window hierarchy. */
export function get(search: Record<string, unknown>): Mode {
  if (typeof window === 'undefined') return 'standalone'
  if (window !== window.parent) return 'iframe'
  if (search.mode === 'popup' && window.opener) return 'popup'
  if (window.opener) return 'popup'
  return 'standalone'
}

/** Whether the window is framed (iframe or `window !== window.parent`). */
export function ensureFramed(mode: Mode) {
  return mode === 'iframe' || (typeof window !== 'undefined' && window !== window.parent)
}

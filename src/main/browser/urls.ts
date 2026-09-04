import type { Settings } from '@shared/types'

const SEARCH: Record<Settings['search']['engine'], string> = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  brave: 'https://search.brave.com/search?q=',
  kagi: 'https://kagi.com/search?q='
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i
// A bare host: at least one dot, no spaces, a plausible TLD.
const BARE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i

export function looksLikeUrl(input: string): boolean {
  const s = input.trim()
  if (!s || /\s/.test(s.split('?')[0])) return false
  if (SCHEME.test(s)) return true
  if (s.startsWith('localhost') || s.startsWith('127.0.0.1')) return true
  return BARE_HOST.test(s)
}

/** True when the input reads as a question rather than a destination. */
export function looksLikeQuestion(input: string): boolean {
  const s = input.trim().toLowerCase()
  if (!s || looksLikeUrl(s)) return false
  if (s.endsWith('?')) return true
  if (s.split(/\s+/).length >= 4) return true
  return /^(who|what|when|where|why|how|is|are|does|do|can|should|which|will|did|was|were)\b/.test(s)
}

export function resolveInput(input: string, engine: Settings['search']['engine']): string {
  const s = input.trim()
  if (!s) return 'about:blank'
  if (SCHEME.test(s)) {
    // Never let the URL bar drive javascript: or file: navigations.
    if (/^(javascript|data|blob):/i.test(s)) return SEARCH[engine] + encodeURIComponent(s)
    return s
  }
  if (looksLikeUrl(s)) return `https://${s}`
  return SEARCH[engine] + encodeURIComponent(s)
}

export function prettyHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

/** Google/Outlook calendar event pages — the trigger for a meeting tab group. */
export function calendarEvent(url: string, title: string): { title: string; source: string } | null {
  try {
    const u = new URL(url)
    const host = u.hostname
    if (host === 'calendar.google.com' && /\/r\/(eventedit|day|week)|\/event/.test(u.pathname + u.search)) {
      return { title: title.replace(/\s*[-–—]\s*Google Calendar\s*$/i, '').trim() || 'Meeting', source: 'Google Calendar' }
    }
    if (host.endsWith('outlook.office.com') || host.endsWith('outlook.live.com')) {
      if (u.pathname.includes('/calendar/')) {
        return { title: title.replace(/\s*[-–—]\s*Outlook\s*$/i, '').trim() || 'Meeting', source: 'Outlook' }
      }
    }
    if (/(^|\.)(zoom\.us|meet\.google\.com|teams\.microsoft\.com)$/.test(host)) {
      return { title: title.trim() || 'Meeting', source: host }
    }
  } catch { /* not a URL */ }
  return null
}

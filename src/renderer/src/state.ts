import { useCallback, useEffect, useRef, useState } from 'react'
import type { FullWindowState, Settings } from '@shared/types'

/** Mirrors the main process's window state. One subscription for the whole app. */
export function useWindowState(): FullWindowState | null {
  const [state, setState] = useState<FullWindowState | null>(null)
  useEffect(() => {
    let alive = true
    void window.voyager.layout.state().then((s) => { if (alive) setState(s) })
    const off = window.voyager.onState(setState)
    return () => { alive = false; off() }
  }, [])
  return state
}

export function useSettings(): [Settings | null, (patch: Record<string, unknown>) => Promise<void>] {
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    void window.voyager.settings.get().then(setSettings)
    return window.voyager.onPaused((paused) => {
      setSettings((current) => current
        ? { ...current, privacy: { ...current.privacy, paused } }
        : current)
    })
  }, [])
  const update = useCallback(async (patch: Record<string, unknown>) => {
    setSettings(await window.voyager.settings.set(patch))
  }, [])
  return [settings, update]
}

/** Applies the user's theme choice to the document element. */
export function useTheme(pref: Settings['appearance']['theme'] | undefined): void {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = pref === 'dark' || (pref !== 'light' && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [pref])
}

export function useAccent(accent: string | undefined): void {
  useEffect(() => {
    if (!accent) return
    document.documentElement.style.setProperty('--accent', accent)
    document.documentElement.style.setProperty('--accent-soft', `${accent}22`)
  }, [accent])
}

export interface Toast { id: number; message: string; kind: 'info' | 'error' }

export function useToasts(): [Toast[], (message: string, kind?: 'info' | 'error') => void] {
  const [toasts, setToasts] = useState<Toast[]>([])
  const next = useRef(1)
  const push = useCallback((message: string, kind: 'info' | 'error' = 'info') => {
    const id = next.current++
    setToasts((t) => [...t, { id, message, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3200)
  }, [])
  useEffect(() => window.voyager.onToast((p) => push(p.message, p.kind ?? 'info')), [push])
  return [toasts, push]
}

/** Escape closes the topmost thing. Panels register in reverse order. */
export function useEscape(fn: () => void, active = true): void {
  useEffect(() => {
    if (!active) return
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); fn() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [fn, active])
}

export function prettyHost(url: string): string {
  try {
    const u = new URL(url)
    if (u.protocol === 'file:') return 'Local file'
    return u.hostname.replace(/^www\./, '')
  } catch { return url }
}

export function relTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const s = Math.round((Date.now() - then) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  if (s < 604800) return `${Math.round(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}

export function bytes(n: number): string {
  if (!n) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

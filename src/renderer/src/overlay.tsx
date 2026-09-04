import { StrictMode, useEffect, useState, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import type { PermissionAsk, Settings } from '@shared/types'
import Palette from './overlay/Palette'
import Omnibox from './overlay/Omnibox'
import Writing from './overlay/Writing'
import Permission from './overlay/Permission'
import ScreenPick, { type ScreenSource } from './overlay/ScreenPick'
import SavePassword from './overlay/SavePassword'
import './overlay.css'

interface Rect { x: number; y: number; width: number; height: number }
type Mode =
  | { kind: 'closed' }
  | { kind: 'palette'; query?: string }
  | { kind: 'omnibox'; anchor: Rect; query: string }
  | { kind: 'writing'; anchor: Rect; tabId: string }
  | { kind: 'permission'; asks: PermissionAsk[] }
  | { kind: 'screenPick'; origin: string; sources: ScreenSource[] }
  | { kind: 'savePassword'; origin: string; username: string; existing: boolean }

function Overlay(): JSX.Element | null {
  const [mode, setMode] = useState<Mode>({ kind: 'closed' })
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => window.kia.overlay.onMode((m) => setMode(m as Mode)), [])
  useEffect(() => { void window.kia.settings.get().then(setSettings) }, [])

  // The overlay covers the whole window, so a click outside the sheet is a dismiss.
  useEffect(() => {
    const dark = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const pref = settings?.appearance.theme
      const isDark = pref === 'dark' || (pref !== 'light' && dark.matches)
      document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
    }
    apply()
    dark.addEventListener('change', apply)
    return () => dark.removeEventListener('change', apply)
  }, [settings])

  useEffect(() => {
    if (settings?.appearance.accent) {
      document.documentElement.style.setProperty('--accent', settings.appearance.accent)
      document.documentElement.style.setProperty('--accent-soft', `${settings.appearance.accent}22`)
    }
  }, [settings])

  const close = (): void => window.kia.overlay.close()

  // Escape closes the overlay — except for the sheets that answer a page's
  // pending promise. Those handle their own Escape, because closing without an
  // answer would leave the site waiting forever.
  useEffect(() => {
    const owns = mode.kind === 'permission' || mode.kind === 'screenPick'
      || mode.kind === 'savePassword'
    if (owns) return
    const h = (e: KeyboardEvent): void => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [mode.kind])

  if (mode.kind === 'closed') return null
  if (mode.kind === 'palette') return <Palette query={mode.query ?? ''} onClose={close} />
  if (mode.kind === 'omnibox') {
    return <Omnibox anchor={mode.anchor} initial={mode.query} settings={settings} onClose={close} />
  }
  if (mode.kind === 'writing') {
    return <Writing anchor={mode.anchor} tabId={mode.tabId} onClose={close} />
  }
  if (mode.kind === 'permission') return <Permission asks={mode.asks} />
  if (mode.kind === 'screenPick') {
    return <ScreenPick origin={mode.origin} sources={mode.sources} />
  }
  if (mode.kind === 'savePassword') {
    return <SavePassword origin={mode.origin} username={mode.username} existing={mode.existing} />
  }
  return null
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><Overlay /></StrictMode>
)

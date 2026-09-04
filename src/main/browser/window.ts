import {
  BaseWindow, WebContentsView, nativeTheme, type Rectangle, type WebContents
} from 'electron'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { TabManager } from './tabs'
import type { FullWindowState, PermissionAsk, Profile, SplitLayout } from '@shared/types'
import { getSettings } from '../store/settings'
import * as db from '../store/db'

/** Chrome geometry. The renderer mirrors these in CSS custom properties. */
export const CHROME = {
  tabStrip: 40,
  toolbar: 44,
  get top(): number { return this.tabStrip + this.toolbar },
  sidebarMin: 320,
  sidebarMax: 760,
  sidebarDefault: 400,
  splitGap: 8
}

/**
 * `isDestroyed()` is not the whole story: between a renderer dying and its view
 * being torn down the frame is gone while the WebContents is not, and `send`
 * throws "Render frame was disposed". A message dropped on the way to a dead
 * frame is not worth an exception in the browser process.
 */
export function post(wc: WebContents, channel: string, ...args: unknown[]): void {
  if (wc.isDestroyed()) return
  try { wc.send(channel, ...args) } catch { /* frame is gone */ }
}

export interface ScreenSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnail: string | null
  icon: string | null
}

export type OverlayMode =
  | { kind: 'closed' }
  | { kind: 'palette'; query?: string }
  | { kind: 'omnibox'; anchor: Rectangle; query: string }
  | { kind: 'writing'; anchor: Rectangle; tabId: string }
  | { kind: 'permission'; asks: PermissionAsk[] }
  | { kind: 'screenPick'; origin: string; sources: ScreenSource[] }
  | { kind: 'savePassword'; origin: string; username: string; existing: boolean }

export class KiaWindow extends EventEmitter {
  readonly window: BaseWindow
  readonly chrome: WebContentsView
  readonly overlay: WebContentsView
  tabs: TabManager
  profile: Profile
  /** Stable across a quit, so this window's tabs come back to this window. */
  readonly key: string

  private sidebarOpen = true
  private sidebarWidth = CHROME.sidebarDefault
  private split: SplitLayout | null = null
  /** Read by the permission code to tell "my sheet" from someone else's. */
  overlayMode: OverlayMode = { kind: 'closed' }
  /** Set while a page holds HTML fullscreen; that tab gets the whole window. */
  private fullscreenTabId: string | null = null
  /** While the opening story runs, the chrome renderer has the window alone. */
  private splash = false
  private attached = new Set<string>()

  constructor(profile: Profile, key: string) {
    super()
    this.profile = profile
    this.key = key

    const mac = process.platform === 'darwin'
    const dark = nativeTheme.shouldUseDarkColors
    this.window = new BaseWindow({
      width: 1440, height: 900, minWidth: 720, minHeight: 480,
      // The tab strip is the title bar on every platform, but the controls sit
      // on opposite sides: macOS insets its traffic lights into our own chrome,
      // Windows and Linux need `titleBarOverlay` or there are no controls at all.
      titleBarStyle: mac ? 'hiddenInset' : 'hidden',
      ...(mac
        ? { trafficLightPosition: { x: 16, y: 12 }, vibrancy: 'sidebar' as const, visualEffectState: 'active' as const }
        : {
            titleBarOverlay: {
              color: dark ? '#141416' : '#f6f6f7',
              symbolColor: dark ? '#e8e6e1' : '#1b1a17',
              height: 38
            }
          }),
      backgroundColor: dark ? '#141416' : '#f6f6f7',
      show: false
    })

    this.chrome = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/chrome.js'),
        contextIsolation: true, sandbox: false, nodeIntegration: false,
        // The opening theme has to start before anyone has clicked anything.
        // Tab views keep Chromium's default, so pages still cannot autoplay.
        autoplayPolicy: 'no-user-gesture-required'
      }
    })
    this.window.contentView.addChildView(this.chrome)

    this.overlay = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/chrome.js'),
        contextIsolation: true, sandbox: false, nodeIntegration: false, transparent: true
      }
    })
    this.overlay.setBackgroundColor('#00000000')
    this.overlay.setVisible(false)

    this.tabs = new TabManager(profile, key)
    this.wireTabs()

    this.window.on('resize', () => this.layout())
    this.window.on('enter-full-screen', () => this.layout())
    this.window.on('leave-full-screen', () => this.layout())
    // Whether these tabs are kept for next launch depends on why the window is
    // closing, which only the app knows. It decides; this just announces.
    this.window.on('close', () => { this.emit('closing') })
    this.window.on('closed', () => { this.emit('closed') })

    nativeTheme.on('updated', () => {
      const isDark = nativeTheme.shouldUseDarkColors
      this.window.setBackgroundColor(isDark ? '#141416' : '#f6f6f7')
      if (!mac) {
        // Windows draws the caption buttons itself; they do not follow CSS.
        this.window.setTitleBarOverlay?.({
          color: isDark ? '#141416' : '#f6f6f7',
          symbolColor: isDark ? '#e8e6e1' : '#1b1a17'
        })
      }
    })
  }

  async load(rendererUrl: string | null, indexFile: string, overlayFile: string): Promise<void> {
    if (rendererUrl) {
      await this.chrome.webContents.loadURL(rendererUrl)
      await this.overlay.webContents.loadURL(`${rendererUrl.replace(/\/$/, '')}/overlay.html`)
    } else {
      await this.chrome.webContents.loadFile(indexFile)
      await this.overlay.webContents.loadFile(overlayFile)
    }
    // Overlay is added last so it paints above tab content.
    this.window.contentView.addChildView(this.overlay)
    this.tabs.restore()
    this.layout()
    this.window.show()
    this.pushState()
  }

  // ——— layout ——————————————————————————————————————————————

  private contentRect(): Rectangle {
    const [w, h] = this.window.getContentSize()
    const sidebar = this.sidebarOpen ? this.sidebarWidth : 0
    return { x: 0, y: CHROME.top, width: Math.max(0, w - sidebar), height: Math.max(0, h - CHROME.top) }
  }

  layout(): void {
    const [w, h] = this.window.getContentSize()
    this.chrome.setBounds({ x: 0, y: 0, width: w, height: h })
    this.overlay.setBounds({ x: 0, y: 0, width: w, height: h })

    // The opening story is drawn by the chrome renderer, which sits *under*
    // the tab views. Detaching them is what lets it be seen at all.
    if (this.splash) {
      for (const id of [...this.attached]) {
        const tab = this.tabs.get(id)
        if (tab) {
          try { this.window.contentView.removeChildView(tab.view) } catch { /* gone */ }
        }
        this.attached.delete(id)
      }
      return
    }

    // A page in fullscreen owns the window: the tab view covers the chrome,
    // which sits beneath it, so there is nothing else to lay out.
    const fs = this.fullscreenTabId ? this.tabs.get(this.fullscreenTabId) : null
    if (fs) {
      for (const id of [...this.attached]) {
        if (id === fs.id) continue
        const tab = this.tabs.get(id)
        if (tab) {
          try { this.window.contentView.removeChildView(tab.view) } catch { /* gone */ }
        }
        this.attached.delete(id)
      }
      if (!this.attached.has(fs.id)) {
        this.window.contentView.addChildView(fs.view, this.overlayIndex())
        this.attached.add(fs.id)
      }
      fs.view.setBounds({ x: 0, y: 0, width: w, height: h })
      fs.view.setVisible(true)
      return
    }

    const rect = this.contentRect()
    const visible = this.visibleTabIds()

    // Detach everything not on screen so offscreen tabs stop compositing.
    for (const id of [...this.attached]) {
      if (visible.includes(id)) continue
      const tab = this.tabs.get(id)
      if (tab) {
        try { this.window.contentView.removeChildView(tab.view) } catch { /* already detached */ }
      }
      this.attached.delete(id)
    }

    if (!visible.length) return

    const ratios = this.split && visible.length === this.split.tabIds.length
      ? this.split.ratios
      : visible.map(() => 1 / visible.length)

    const gap = visible.length > 1 ? CHROME.splitGap : 0
    const usable = rect.width - gap * (visible.length - 1)
    let x = rect.x

    visible.forEach((id, i) => {
      const tab = this.tabs.get(id)
      if (!tab) return
      const width = Math.round(usable * (ratios[i] ?? 1 / visible.length))
      if (!this.attached.has(id)) {
        // Insert beneath the overlay so the palette keeps painting on top.
        this.window.contentView.addChildView(tab.view, this.overlayIndex())
        this.attached.add(id)
      }
      tab.view.setBounds({ x: Math.round(x), y: rect.y, width, height: rect.height })
      tab.view.setVisible(true)
      x += width + gap
    })
  }

  private overlayIndex(): number {
    const children = this.window.contentView.children
    const idx = children.indexOf(this.overlay)
    return idx === -1 ? children.length : idx
  }

  private visibleTabIds(): string[] {
    if (this.split?.tabIds.length) {
      const live = this.split.tabIds.filter((id) => this.tabs.get(id))
      if (live.length) return live
      this.split = null
    }
    return this.tabs.activeId ? [this.tabs.activeId] : []
  }

  // ——— sidebar / splits ————————————————————————————————————

  toggleSidebar(open?: boolean): void {
    this.sidebarOpen = open ?? !this.sidebarOpen
    this.layout()
    this.pushState()
  }

  setSidebarWidth(px: number): void {
    this.sidebarWidth = Math.max(CHROME.sidebarMin, Math.min(CHROME.sidebarMax, Math.round(px)))
    this.layout()
    this.pushState()
  }

  setSplit(tabIds: string[]): void {
    const live = tabIds.filter((id) => this.tabs.get(id)).slice(0, 4)
    this.split = live.length > 1
      ? { tabIds: live, ratios: live.map(() => 1 / live.length) }
      : null
    if (this.split && this.tabs.activeId && !this.split.tabIds.includes(this.tabs.activeId)) {
      this.tabs.activate(this.split.tabIds[0])
    }
    this.layout()
    this.pushState()
  }

  clearSplit(): void {
    this.split = null
    this.layout()
    this.pushState()
  }

  setSplitRatios(ratios: number[]): void {
    if (!this.split) return
    const sum = ratios.reduce((a, b) => a + b, 0)
    if (sum <= 0) return
    // Clamp so a pane can never be dragged to zero width.
    const min = 0.12
    const norm = ratios.map((r) => Math.max(min, r / sum))
    const total = norm.reduce((a, b) => a + b, 0)
    this.split.ratios = norm.map((r) => r / total)
    this.layout()
    this.pushState()
  }

  // ——— opening story ———————————————————————————————————————

  /** Hold the tab views back so the chrome can draw the story. */
  beginSplash(): void {
    if (this.splash) return
    this.splash = true
    this.layout()
    // A story that never ends because the renderer died would be a browser you
    // cannot use. This is the floor, not the schedule.
    setTimeout(() => this.endSplash(), 12_000)
  }

  endSplash(): void {
    if (!this.splash) return
    this.splash = false
    this.layout()
  }

  // ——— overlay —————————————————————————————————————————————

  showOverlay(mode: OverlayMode): void {
    this.overlayMode = mode
    const open = mode.kind !== 'closed'
    this.overlay.setVisible(open)
    post(this.overlay.webContents, 'kia:overlay-mode', mode)
    if (open) this.overlay.webContents.focus()
    else this.focusContent()
  }

  closeOverlay(): void { this.showOverlay({ kind: 'closed' }) }
  get overlayOpen(): boolean { return this.overlayMode.kind !== 'closed' }

  focusContent(): void {
    const tab = this.tabs.active()
    if (tab) tab.view.webContents.focus()
  }

  focusChrome(): void { this.chrome.webContents.focus() }

  // ——— profile ————————————————————————————————————————————

  switchProfile(profile: Profile): void {
    this.tabs.persist()
    this.tabs.destroy()
    for (const id of [...this.attached]) this.attached.delete(id)
    this.profile = profile
    this.tabs = new TabManager(profile, this.key)
    this.wireTabs()
    this.tabs.restore()
    this.layout()
    this.pushState()
  }

  // ——— state ———————————————————————————————————————————————

  state(): FullWindowState {
    return {
      profileId: this.profile.id,
      activeTabId: this.tabs.activeId,
      split: this.split,
      sidebarOpen: this.sidebarOpen,
      sidebarWidth: this.sidebarWidth,
      tabs: this.tabs.list(),
      groups: this.tabs.groups,
      profile: this.profile,
      profiles: db.listProfiles()
    }
  }

  pushState(): void {
    post(this.chrome.webContents, 'kia:state-changed', this.state())
  }

  private wireTabs(): void {
    this.tabs.on('changed', () => { this.layout(); this.pushState() })
    this.tabs.on('activated', () => { this.layout(); this.focusContent() })
    this.tabs.on('detach', (tab) => {
      try { this.window.contentView.removeChildView(tab.view) } catch { /* fine */ }
      this.attached.delete(tab.id)
    })
    this.tabs.on('load-failed', (tab, info) => {
      post(this.chrome.webContents, 'kia:load-failed', { tabId: tab.id, ...info })
    })
    this.tabs.on('crashed', (tab) => {
      post(this.chrome.webContents, 'kia:tab-crashed', { tabId: tab.id })
    })
    this.tabs.on('html-fullscreen', (tab: { id: string }, on: boolean) => {
      // Only the tab the user is looking at may take the window.
      if (on && this.tabs.activeId !== tab.id) return
      this.fullscreenTabId = on ? tab.id : null
      // Match what a browser does: the OS window goes fullscreen too.
      if (this.window.isFullScreen() !== on) this.window.setFullScreen(on)
      this.layout()
    })
  }

  findInPage(text: string, forward = true): void {
    const wc = this.tabs.active()?.view.webContents
    if (!wc) return
    if (!text) return wc.stopFindInPage('clearSelection')
    wc.findInPage(text, { forward, findNext: true })
  }

  stopFind(): void {
    this.tabs.active()?.view.webContents.stopFindInPage('clearSelection')
  }
}

import { WebContentsView } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { TabState, TabGroup, Profile } from '@shared/types'
import { sessionFor } from './session'
import { resolveInput, calendarEvent } from './urls'
import { getSettings, isExcluded } from '../store/settings'
import * as db from '../store/db'

export interface Tab {
  id: string
  view: WebContentsView
  state: TabState
  /** history row id for the current navigation, so dwell can be attributed */
  historyId: number | null
  activatedAt: number | null
}

const NEW_TAB = 'kia://new-tab'

export class TabManager extends EventEmitter {
  readonly tabs = new Map<string, Tab>()
  private order: string[] = []
  activeId: string | null = null
  groups: TabGroup[] = []

  /** `windowKey` scopes session restore: two windows must not share a tab set. */
  constructor(private profile: Profile, readonly windowKey: string) {
    super()
    this.groups = db.listGroups(profile.id)
  }

  get profileId(): string { return this.profile.id }

  setProfile(p: Profile): void {
    this.profile = p
    this.groups = db.listGroups(p.id)
  }

  list(): TabState[] {
    return this.order
      .map((id) => this.tabs.get(id))
      .filter((t): t is Tab => !!t)
      .map((t, i) => ({ ...t.state, index: i }))
  }

  get(id: string): Tab | undefined { return this.tabs.get(id) }
  active(): Tab | undefined { return this.activeId ? this.tabs.get(this.activeId) : undefined }

  /** Map an IPC sender back to the tab it came from. */
  byWebContentsId(id: number): Tab | undefined {
    for (const t of this.tabs.values()) {
      if (!t.view.webContents.isDestroyed() && t.view.webContents.id === id) return t
    }
    return undefined
  }

  // ——— lifecycle ———————————————————————————————————————————

  create(opts: { url?: string; background?: boolean; groupId?: string | null; index?: number } = {}): Tab {
    const id = randomUUID()
    const view = new WebContentsView({
      webPreferences: {
        session: sessionFor(this.profile.partition, this.profile.id),
        preload: join(__dirname, '../preload/page.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: true,
        scrollBounce: true,
        // Chromium's built-in PDF viewer. Without this a PDF link downloads
        // instead of rendering, which is not what a browser does.
        plugins: true
      }
    })

    const now = new Date().toISOString()
    const url = opts.url ?? NEW_TAB
    const tab: Tab = {
      id, view, historyId: null, activatedAt: null,
      state: {
        id, profileId: this.profile.id, groupId: opts.groupId ?? null,
        url, title: 'New Tab', favicon: null, loading: false,
        canGoBack: false, canGoForward: false, audible: false, muted: false,
        pinned: false, index: this.order.length, lastActiveAt: now, createdAt: now
      }
    }

    this.wire(tab)
    this.tabs.set(id, tab)
    if (typeof opts.index === 'number') this.order.splice(opts.index, 0, id)
    else this.order.push(id)

    if (url !== NEW_TAB) void view.webContents.loadURL(url)

    if (!opts.background) this.activate(id)
    this.changed()
    return tab
  }

  close(id: string): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    this.recordDwell(tab)
    const idx = this.order.indexOf(id)
    this.order = this.order.filter((t) => t !== id)
    this.tabs.delete(id)
    this.emit('detach', tab)
    // Destroying synchronously in a webContents event handler crashes; defer.
    setImmediate(() => {
      try { tab.view.webContents.close() } catch { /* already gone */ }
    })

    if (this.activeId === id) {
      const next = this.order[Math.min(idx, this.order.length - 1)] ?? null
      this.activeId = null
      if (next) this.activate(next)
    }
    this.changed()
  }

  activate(id: string): void {
    if (!this.tabs.has(id)) return
    if (this.activeId === id) return
    const prev = this.activeId ? this.tabs.get(this.activeId) : undefined
    if (prev) this.recordDwell(prev)

    this.activeId = id
    const tab = this.tabs.get(id)!
    tab.state.lastActiveAt = new Date().toISOString()
    tab.activatedAt = Date.now()
    this.emit('activated', tab)
    this.changed()
  }

  reorder(ids: string[]): void {
    const known = ids.filter((i) => this.tabs.has(i))
    const missing = this.order.filter((i) => !known.includes(i))
    this.order = [...known, ...missing]
    this.changed()
  }

  move(id: string, toIndex: number): void {
    const from = this.order.indexOf(id)
    if (from < 0) return
    this.order.splice(from, 1)
    this.order.splice(Math.max(0, Math.min(toIndex, this.order.length)), 0, id)
    this.changed()
  }

  duplicate(id: string): Tab | null {
    const tab = this.tabs.get(id)
    if (!tab) return null
    return this.create({
      url: tab.state.url, groupId: tab.state.groupId,
      index: this.order.indexOf(id) + 1
    })
  }

  // ——— navigation ——————————————————————————————————————————

  navigate(id: string, input: string): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    const url = resolveInput(input, getSettings().search.engine)
    void tab.view.webContents.loadURL(url).catch(() => { /* surfaced via did-fail-load */ })
  }

  back(id: string): void {
    const wc = this.tabs.get(id)?.view.webContents
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  forward(id: string): void {
    const wc = this.tabs.get(id)?.view.webContents
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  }

  reload(id: string, hard = false): void {
    const wc = this.tabs.get(id)?.view.webContents
    if (!wc) return
    hard ? wc.reloadIgnoringCache() : wc.reload()
  }

  stop(id: string): void { this.tabs.get(id)?.view.webContents.stop() }

  setMuted(id: string, muted: boolean): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    tab.view.webContents.setAudioMuted(muted)
    tab.state.muted = muted
    this.changed()
  }

  setPinned(id: string, pinned: boolean): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    tab.state.pinned = pinned
    // Pinned tabs live at the front of the strip, like every other browser.
    this.order = [
      ...this.order.filter((i) => this.tabs.get(i)?.state.pinned),
      ...this.order.filter((i) => !this.tabs.get(i)?.state.pinned)
    ]
    this.changed()
  }

  setZoom(id: string, level: number): void {
    const wc = this.tabs.get(id)?.view.webContents
    if (wc) wc.setZoomLevel(Math.max(-5, Math.min(5, level)))
  }

  // ——— groups ——————————————————————————————————————————————

  createGroup(title: string, color = '#6366f1', meeting: TabGroup['meeting'] = null): TabGroup {
    const g: TabGroup = {
      id: randomUUID(), profileId: this.profile.id, title, color,
      collapsed: false, meeting, createdAt: new Date().toISOString()
    }
    this.groups.push(g)
    db.upsertGroup(g)
    this.changed()
    return g
  }

  updateGroup(id: string, patch: Partial<TabGroup>): void {
    const g = this.groups.find((x) => x.id === id)
    if (!g) return
    Object.assign(g, patch)
    db.upsertGroup(g)
    this.changed()
  }

  deleteGroup(id: string, closeTabs = false): void {
    this.groups = this.groups.filter((g) => g.id !== id)
    db.deleteGroup(id)
    for (const t of this.tabs.values()) {
      if (t.state.groupId !== id) continue
      if (closeTabs) this.close(t.id)
      else t.state.groupId = null
    }
    this.changed()
  }

  assign(tabIds: string[], groupId: string | null): void {
    for (const id of tabIds) {
      const t = this.tabs.get(id)
      if (t) t.state.groupId = groupId
    }
    this.changed()
  }

  /**
   * Dia's meeting behaviour: when a calendar event is open, every tab opened
   * afterwards joins a group named for that event. The group is armed by the
   * calendar tab and stays armed while it is open.
   */
  private armedMeeting: { groupId: string; until: number } | null = null

  private maybeArmMeeting(tab: Tab): void {
    const hit = calendarEvent(tab.state.url, tab.state.title)
    if (!hit) return
    const existing = this.groups.find((g) => g.meeting && g.meeting.eventTitle === hit.title)
    const group = existing ?? this.createGroup(hit.title, '#0ea5e9', {
      eventTitle: hit.title, startsAt: new Date().toISOString(), endsAt: null, source: hit.source
    })
    tab.state.groupId = group.id
    // Two hours is long enough for a meeting, short enough not to swallow the day.
    this.armedMeeting = { groupId: group.id, until: Date.now() + 2 * 3600_000 }
  }

  private inheritMeeting(tab: Tab): void {
    if (!this.armedMeeting) return
    if (Date.now() > this.armedMeeting.until) { this.armedMeeting = null; return }
    if (tab.state.groupId) return
    if (!this.groups.some((g) => g.id === this.armedMeeting!.groupId)) { this.armedMeeting = null; return }
    tab.state.groupId = this.armedMeeting.groupId
  }

  // ——— housekeeping —————————————————————————————————————————

  /** Tabs untouched for `days` — the input to "tidy up" suggestions. */
  idleTabs(days: number): TabState[] {
    const cutoff = Date.now() - days * 864e5
    return this.list().filter(
      (t) => !t.pinned && new Date(t.lastActiveAt).getTime() < cutoff
    )
  }

  persist(): void {
    db.replaceSavedTabs(this.profile.id, this.windowKey, this.list().map((t) => ({
      id: t.id, profileId: t.profileId, groupId: t.groupId, url: t.url,
      title: t.title, favicon: t.favicon, pinned: t.pinned, index: t.index,
      lastActiveAt: t.lastActiveAt, createdAt: t.createdAt
    })))
  }

  restore(): void {
    const saved = db.loadSavedTabs(this.profile.id, this.windowKey)
    if (!saved.length) { this.create({ url: NEW_TAB }); return }
    for (const s of saved) {
      const tab = this.create({ url: s.url, background: true, groupId: s.groupId })
      tab.state.pinned = s.pinned
      tab.state.title = s.title
      tab.state.favicon = s.favicon
      tab.state.createdAt = s.createdAt
      tab.state.lastActiveAt = s.lastActiveAt
    }
    const first = this.order[0]
    if (first) this.activate(first)
    this.changed()
  }

  destroy(): void {
    for (const id of [...this.order]) this.close(id)
  }

  // ——— internals ————————————————————————————————————————————

  private recordDwell(tab: Tab): void {
    if (tab.activatedAt && tab.historyId) {
      db.setDwell(tab.historyId, Date.now() - tab.activatedAt)
    }
    tab.activatedAt = null
  }

  private changed(): void {
    this.emit('changed')
  }

  private wire(tab: Tab): void {
    const wc = tab.view.webContents
    // The ad blocker injects one scriptlet per cosmetic filter with
    // executeJavaScript, and each call parks a one-shot did-stop-loading
    // listener until the page settles. A filter-heavy page runs to hundreds, so
    // any fixed cap is the wrong number; they all clear on the next load.
    wc.setMaxListeners(0)
    const sync = () => {
      tab.state.canGoBack = wc.navigationHistory.canGoBack()
      tab.state.canGoForward = wc.navigationHistory.canGoForward()
      this.changed()
    }

    wc.on('page-title-updated', (_e, title) => {
      tab.state.title = title
      this.maybeArmMeeting(tab)
      this.changed()
    })

    wc.on('page-favicon-updated', (_e, icons) => {
      tab.state.favicon = icons[0] ?? null
      this.changed()
    })

    wc.on('did-start-loading', () => { tab.state.loading = true; this.changed() })
    wc.on('did-stop-loading', () => { tab.state.loading = false; sync() })

    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame) return
      this.recordDwell(tab)
      tab.historyId = null
      tab.state.url = details.url
      this.changed()
    })

    wc.on('did-navigate', (_e, url) => {
      tab.state.url = url
      this.inheritMeeting(tab)
      sync()
    })

    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) { tab.state.url = url; sync() }
    })

    wc.on('did-finish-load', () => {
      tab.activatedAt ??= Date.now()
      void this.recordVisit(tab)
    })

    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (!isMainFrame || code === -3 /* aborted */) return
      tab.state.loading = false
      this.emit('load-failed', tab, { code, desc, url })
      this.changed()
    })

    wc.on('audio-state-changed', (event) => {
      tab.state.audible = event.audible
      this.changed()
    })

    wc.on('render-process-gone', (_e, details) => {
      this.emit('crashed', tab, details)
    })

    // Anything that would open a window becomes a tab next to its opener.
    wc.setWindowOpenHandler(({ url, disposition }) => {
      const background = disposition === 'background-tab'
      this.create({ url, background, index: this.order.indexOf(tab.id) + 1, groupId: tab.state.groupId })
      return { action: 'deny' }
    })

    wc.on('context-menu', (_e, params) => {
      this.emit('context-menu', tab, params)
    })

    // A page asking for fullscreen has to be handled by the window: the tab is
    // a child view sitting under the chrome, so it cannot fill the screen alone.
    wc.on('enter-html-full-screen', () => this.emit('html-fullscreen', tab, true))
    wc.on('leave-html-full-screen', () => this.emit('html-fullscreen', tab, false))
  }

  /** Records a visit, honouring exclusions and the global pause. */
  private async recordVisit(tab: Tab): Promise<void> {
    const settings = getSettings()
    const url = tab.state.url
    if (!url || url === NEW_TAB || url.startsWith('about:')) return
    if (settings.privacy.paused || isExcluded(url, settings)) return

    let excerpt: string | null = null
    try {
      const extracted = await tab.view.webContents.executeJavaScript(
        'window.__kia?.extract?.() ?? null', true
      )
      if (extracted?.text) excerpt = String(extracted.text).slice(0, 4000)
      if (extracted?.title) tab.state.title = extracted.title
    } catch { /* page blocked the eval; title-only history is fine */ }

    tab.historyId = db.addHistory(this.profile.id, url, tab.state.title, excerpt)
  }
}

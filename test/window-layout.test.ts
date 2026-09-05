import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class View {
    bounds = { x: 0, y: 0, width: 0, height: 0 }
    webContents = Object.assign(new EventEmitter(), { id: Math.random(), isDestroyed: () => false,
      send() {}, focus() {}, loadURL: async () => {}, setWindowOpenHandler() {} })
    setBounds(r: any) { if (r.width < 0 || r.height < 0) throw new Error('Negative bounds'); this.bounds = r }
    setBackgroundColor() {} setVisible() {}
  }
  class Window extends EventEmitter {
    size = [1440, 900]
    contentView = {
      children: [] as View[],
      addChildView(v: View, index?: number) { this.children.splice(index ?? this.children.length, 0, v) },
      removeChildView(v: View) { this.children = this.children.filter((c) => c !== v) }
    }
    getContentSize() { return this.size }
    isDestroyed() { return false }
    setAutoHideMenuBar() {} setMenuBarVisibility() {} show() {}
    isFullScreen() { return false } setFullScreen() {}
  }
  return { BaseWindow: Window, WebContentsView: View, app: { getAppPath: () => '/tmp', isPackaged: false },
    nativeTheme: Object.assign(new EventEmitter(), { shouldUseDarkColors: false }), session: { defaultSession: {} } }
})
const settings = vi.hoisted(() => ({ privacy: { spellcheckEnabled: false }, appearance: { compactChrome: false } }))
vi.mock('../src/main/store/settings', () => ({ getSettings: () => settings,
  setSettings: (patch: any) => { Object.assign(settings.appearance, patch.appearance) } }))
vi.mock('../src/main/store/db', () => ({ ensureBookmarkShortcuts() {}, watchBookmarks: () => () => {}, listProfiles: () => [], listBookmarkShortcuts: () => [] }))
vi.mock('../src/main/security/spellcheck', () => ({ configureSpellcheck() {} }))
vi.mock('../src/main/browser/chromeImport', () => ({ cancelChromeImport() {} }))
vi.mock('../src/main/browser/tabs', async () => {
  const { EventEmitter } = await import('node:events')
  const { WebContentsView } = await import('electron')
  return { TabManager: class extends EventEmitter {
    activeId = 'one'; groups = []
    rows = ['one', 'two'].map((id) => ({ id, view: new WebContentsView(), state: { id } }))
    get(id: string) { return this.rows.find((r) => r.id === id) }
    active() { return this.get(this.activeId) }
    list() { return this.rows.map((r) => r.state) }
    restore() {} activate(id: string) { this.activeId = id }
  } }
})
import { VoyagerWindow } from '../src/main/browser/window'

describe('horizontal browser layout', () => {
  beforeEach(() => { settings.appearance.compactChrome = false })
  async function create() {
    const win = new VoyagerWindow({ id: 'p' } as any, 'w')
    await win.load(null)
    return win
  }
  it('keeps pages below both toolbar rows and the bookmarks bar, with no left inset', async () => {
    const w = await create()
    expect((w.tabs.active()!.view as any).bounds).toEqual({ x: 0, y: 120, width: 1440, height: 780 })
    w.toggleBookmarksBar()
    expect((w.tabs.active()!.view as any).bounds).toEqual({ x: 0, y: 88, width: 1440, height: 812 })
    w.window.emit('closed')
  })
  it('detaches page views for panels, restores them when closed, and leaves overlay on top', async () => {
    const w = await create()
    const page = w.tabs.active()!.view
    w.setPanelVisible(true)
    expect(w.window.contentView.children).not.toContain(page)
    w.setPanelVisible(false)
    expect(w.window.contentView.children).toContain(page)
    expect(w.window.contentView.children.at(-1)).toBe(w.overlay)
    w.window.emit('closed')
  })
  it('fits the sidebar and split pages in a narrow window without negative bounds', async () => {
    const w = await create()
    ;(w.window as any).size = [720, 480]
    w.toggleSidebar(true); w.setSidebarWidth(760); w.setSplit(['one', 'two'])
    expect(w.state().sidebarWidth).toBe(400)
    expect((w.tabs.get('one')!.view as any).bounds).toEqual({ x: 0, y: 120, width: 156, height: 360 })
    expect((w.tabs.get('two')!.view as any).bounds).toEqual({ x: 164, y: 120, width: 156, height: 360 })
    w.window.emit('closed')
  })
})

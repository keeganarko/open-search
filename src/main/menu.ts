import {
  Menu, MenuItem, app, clipboard, shell, type MenuItemConstructorOptions, type WebContents
} from 'electron'
import { post, type VoyagerWindow } from './browser/window'
import { openExternal } from './browser/session'
import * as db from './store/db'
import { getSettings, setSettings } from './store/settings'
import { IPC } from '@shared/ipc'
import { pageAgents } from './agent/agentRuntime'

type GetWindow = () => VoyagerWindow | null

/**
 * index.ts owns the window set, and importing it here would be a cycle, so it
 * hands the menu a way to open one instead.
 */
let openNewWindow: () => void = () => {}
export function setNewWindowHandler(fn: () => void): void { openNewWindow = fn }

/**
 * Skills that declare a hotkey become menu items. An accelerator on a menu item
 * is scoped to the app; globalShortcut would take the chord away from every
 * other application on the machine, which is not what a browser should do.
 */
function skillItems(send: (channel: string, ...args: unknown[]) => void): MenuItemConstructorOptions[] {
  let skills: ReturnType<typeof db.listSkills> = []
  try { skills = db.listSkills() } catch { return [] }
  const withKeys = skills.filter((s) => s.hotkey)
  if (!withKeys.length) return []
  return [
    ...withKeys.map((s) => ({
      label: s.name,
      accelerator: s.hotkey ?? undefined,
      click: () => send('voyager:ask', { prompt: '', skill: s.slug })
    })),
    { type: 'separator' as const }
  ]
}

export function buildAppMenu(getWindow: GetWindow): void {
  const w = () => getWindow()
  const tabId = () => w()?.tabs.activeId ?? null
  const send = (channel: string, ...args: unknown[]) =>
    { const c = w()?.chrome.webContents; if (c) post(c, channel, ...args) }

  const mac = process.platform === 'darwin'

  // `services`, `hide`, `hideOthers` and `unhide` exist only on macOS, and the
  // application menu itself is a macOS convention — elsewhere Settings and Quit
  // belong at the foot of File.
  const appMenu: MenuItemConstructorOptions[] = mac
    ? [{
        label: 'Voyager',
        submenu: [
          { role: 'about', label: 'About Voyager' },
          { type: 'separator' },
          { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('voyager:open-settings') },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide', label: 'Hide Voyager' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit', label: 'Quit Voyager' }
        ]
      }]
    : []

  const template: MenuItemConstructorOptions[] = [
    ...appMenu,
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => w()?.tabs.create({}) },
        {
          label: 'New Window', accelerator: 'CmdOrCtrl+N',
          click: () => openNewWindow()
        },
        { type: 'separator' },
        {
          label: 'Close Tab', accelerator: 'CmdOrCtrl+W',
          click: () => { const id = tabId(); if (id) w()?.tabs.close(id) }
        },
        {
          label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T',
          click: () => {
            if (!w()?.tabs.reopenClosed()) send('voyager:toast', 'Nothing to reopen.')
          }
        },
        { type: 'separator' },
        {
          label: 'Print…', accelerator: 'CmdOrCtrl+P',
          click: () => {
            const wc = w()?.tabs.active()?.view.webContents
            wc?.print({ silent: false, printBackground: true })
          }
        },
        {
          // No accelerator: it collided with Pin Tab, and Electron silently gives
          // a duplicate to whichever item registers first — which was this one,
          // so pinning never fired. Pin won; ⌘P's print sheet can still save a PDF.
          label: 'Save as PDF…',
          click: () => send('voyager:print-pdf')
        },
        { type: 'separator' },
        {
          label: 'Save Page As Deck…',
          click: () => send('voyager:open-deck-composer')
        },
        // No application menu off macOS, so these land here instead.
        ...(mac ? [] : [
          { type: 'separator' } as MenuItemConstructorOptions,
          { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('voyager:open-settings') },
          { type: 'separator' } as MenuItemConstructorOptions,
          { role: 'quit', label: 'Exit' } as MenuItemConstructorOptions
        ])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'pasteAndMatchStyle' }, { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find in Page…', accelerator: 'CmdOrCtrl+F',
          click: () => send('voyager:open-find')
        },
        {
          label: 'Copy Current URL', accelerator: 'CmdOrCtrl+Shift+C',
          click: () => {
            const url = w()?.tabs.active()?.state.url
            if (url) clipboard.writeText(url)
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload', accelerator: 'CmdOrCtrl+R',
          click: () => { const id = tabId(); if (id) w()?.tabs.reload(id) }
        },
        {
          label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R',
          click: () => { const id = tabId(); if (id) w()?.tabs.reload(id, true) }
        },
        { type: 'separator' },
        {
          label: 'Actual Size', accelerator: 'CmdOrCtrl+0',
          click: () => { const id = tabId(); if (id) w()?.tabs.setZoom(id, 0) }
        },
        {
          label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus',
          click: () => zoomBy(w(), 0.5)
        },
        {
          label: 'Zoom Out', accelerator: 'CmdOrCtrl+-',
          click: () => zoomBy(w(), -0.5)
        },
        { type: 'separator' },
        {
          label: 'Show Bookmarks Bar', accelerator: 'CmdOrCtrl+Shift+B',
          click: () => w()?.toggleBookmarksBar()
        },
        {
          label: 'Toggle Voyager Sidebar', accelerator: 'CmdOrCtrl+Shift+K',
          click: () => w()?.toggleSidebar()
        },
        {
          label: 'Split with Next Tab', accelerator: 'CmdOrCtrl+Shift+D',
          click: () => splitWithNext(w())
        },
        {
          label: 'Clear Split', accelerator: 'CmdOrCtrl+Shift+X',
          click: () => w()?.clearSplit()
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        {
          label: 'Developer Tools (page)', accelerator: 'CmdOrCtrl+Alt+I',
          click: () => w()?.tabs.active()?.view.webContents.toggleDevTools()
        },
        {
          label: 'Developer Tools (Voyager UI)', accelerator: 'CmdOrCtrl+Alt+Shift+I',
          visible: !app.isPackaged,
          click: () => w()?.chrome.webContents.toggleDevTools()
        }
      ]
    },
    {
      label: 'History',
      submenu: [
        {
          label: 'Back', accelerator: 'CmdOrCtrl+[',
          click: () => { const id = tabId(); if (id) w()?.tabs.back(id) }
        },
        {
          label: 'Forward', accelerator: 'CmdOrCtrl+]',
          click: () => { const id = tabId(); if (id) w()?.tabs.forward(id) }
        },
        { type: 'separator' },
        {
          // Chrome's own binding on each platform: ⌘Y on the Mac, Ctrl+H elsewhere.
          label: 'Show All History',
          accelerator: process.platform === 'darwin' ? 'Cmd+Y' : 'Ctrl+H',
          click: () => send('voyager:open-history')
        },
        {
          label: 'Clear History…',
          click: () => send('voyager:open-privacy')
        }
      ]
    },
    {
      label: 'Tabs',
      submenu: [
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((n): MenuItemConstructorOptions => ({
          label: `Tab ${n}`, accelerator: `CmdOrCtrl+${n}`, visible: false,
          click: () => {
            const list = w()?.tabs.list() ?? []
            const t = list[n - 1]
            if (t) w()?.tabs.activate(t.id)
          }
        })),
        {
          label: 'Last Tab', accelerator: 'CmdOrCtrl+9', visible: false,
          click: () => {
            const list = w()?.tabs.list() ?? []
            const t = list[list.length - 1]
            if (t) w()?.tabs.activate(t.id)
          }
        },
        {
          label: 'Next Tab', accelerator: 'Control+Tab',
          click: () => cycleTab(w(), 1)
        },
        {
          label: 'Previous Tab', accelerator: 'Control+Shift+Tab',
          click: () => cycleTab(w(), -1)
        },
        { type: 'separator' },
        {
          label: 'Pin Tab', accelerator: 'CmdOrCtrl+Shift+P',
          click: () => {
            const t = w()?.tabs.active()
            if (t) w()?.tabs.setPinned(t.id, !t.state.pinned)
          }
        },
        {
          label: 'Duplicate Tab',
          click: () => { const id = tabId(); if (id) w()?.tabs.duplicate(id) }
        },
        {
          label: 'Mute Tab', accelerator: 'CmdOrCtrl+Shift+M',
          click: () => {
            const t = w()?.tabs.active()
            if (t) w()?.tabs.setMuted(t.id, !t.state.muted)
          }
        },
        { type: 'separator' },
        { label: 'Organize Tabs with Voyager', click: () => send('voyager:auto-organize') },
        { label: 'Tidy Idle Tabs…', click: () => send('voyager:open-tidy') }
      ]
    },
    {
      label: 'Voyager',
      submenu: [
        {
          label: 'Ask Voyager', accelerator: 'CmdOrCtrl+K',
          click: () => { w()?.toggleSidebar(true); send('voyager:focus-composer') }
        },
        {
          label: 'Agents', accelerator: 'CmdOrCtrl+Shift+A',
          click: () => { w()?.toggleSidebar(true); w()?.focusChrome(); send(IPC.agentsOpen) }
        },
        {
          label: 'Command Palette', accelerator: 'CmdOrCtrl+Shift+L',
          click: () => w()?.showOverlay({ kind: 'palette' })
        },
        {
          label: 'Focus Address Bar', accelerator: 'CmdOrCtrl+L',
          click: () => send('voyager:focus-omnibox')
        },
        { type: 'separator' },
        ...skillItems(send),
        { label: 'Skills…', click: () => send('voyager:open-skills') },
        { label: 'Memory…', click: () => send('voyager:open-memory') },
        { label: 'Connectors…', click: () => send('voyager:open-connectors') },
        { label: 'Morning Brief', click: () => send('voyager:open-brief') },
        { type: 'separator' },
        {
          label: 'Pause Page Reading',
          type: 'checkbox',
          checked: getSettings().privacy.paused,
          click: (item) => {
            setSettings({ privacy: { paused: item.checked } } as any)
            pageAgents.revokeAll('Page reading settings changed. Start again to grant access.')
            send('voyager:set-paused', item.checked)
          }
        }
      ]
    },
    {
      label: 'Bookmarks',
      submenu: [
        {
          label: 'Bookmark This Page', accelerator: 'CmdOrCtrl+D',
          click: () => {
            const win = w(); const t = win?.tabs.active()
            if (win && t) {
              db.addBookmark(win.profile.id, t.state.url, t.state.title, null)
              send('voyager:toast', `Bookmarked “${t.state.title}”`)
            }
          }
        },
        {
          label: 'Show All Bookmarks', accelerator: 'CmdOrCtrl+Shift+O',
          click: () => send('voyager:open-bookmarks')
        },
        { label: 'Import from Chrome…', click: () => send('voyager:open-import') }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Voyager Keyboard Shortcuts', click: () => send('voyager:open-shortcuts') },
        {
          label: 'Anthropic Console (get an API key)',
          click: () => shell.openExternal('https://console.anthropic.com/settings/keys')
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Native menus paint above page views and keep keyboard navigation accessible. */
export function showBrowserMenu(win: VoyagerWindow): void {
  const panel = (name: string) => () => post(win.chrome.webContents, `voyager:open-${name}`)
  Menu.buildFromTemplate([
    { label: 'New tab', click: () => win.tabs.create({}) },
    { label: 'New window', click: () => openNewWindow() },
    { label: 'Reopen closed tab', click: () => win.tabs.reopenClosed() },
    { type: 'separator' },
    { label: 'History', click: panel('history') },
    { label: 'Downloads', click: panel('downloads') },
    { label: 'Bookmarks', click: panel('bookmarks') },
    { label: 'Show bookmarks bar', type: 'checkbox', checked: win.state().bookmarksBarOpen, click: () => win.toggleBookmarksBar() },
    { label: 'Import from Chrome…', click: panel('import') },
    { type: 'separator' },
    { label: 'Zoom in', click: () => zoomBy(win, 0.5) },
    { label: 'Zoom out', click: () => zoomBy(win, -0.5) },
    { label: 'Print…', click: () => win.tabs.active()?.view.webContents.print({ silent: false }) },
    { label: 'Find in page…', click: panel('find') },
    { label: 'Split with next tab', click: () => splitWithNext(win) },
    { label: 'Clear split', enabled: !!win.state().split, click: () => win.clearSplit() },
    { type: 'separator' },
    { label: 'Voyager', submenu: [
      { label: 'Agents', click: () => { win.toggleSidebar(true); win.focusChrome(); post(win.chrome.webContents, IPC.agentsOpen) } },
      { label: 'Ask Voyager', click: () => { win.toggleSidebar(true); post(win.chrome.webContents, 'voyager:focus-composer') } },
      { label: 'Organize tabs', click: () => post(win.chrome.webContents, 'voyager:auto-organize') },
      { label: 'Tidy tabs', click: panel('tidy') },
      ...[['Skills', 'skills'], ['Memory', 'memory'], ['Connectors', 'connectors'], ['Morning brief', 'brief'], ['Compose a deck', 'deck-composer']]
        .map(([label, name]) => ({ label, click: panel(name) }))
    ] },
    { label: 'Settings', click: panel('settings') },
    { label: 'Keyboard shortcuts', click: panel('shortcuts') }
  ]).popup({ window: win.window })
}

export function showProfileMenu(win: VoyagerWindow, switchProfile: (id: string) => void): void {
  Menu.buildFromTemplate([
    { label: 'Voyager profiles', enabled: false },
    ...db.listProfiles().map((p) => ({ label: p.name, type: 'radio' as const, checked: p.id === win.profile.id,
      click: () => switchProfile(p.id) })),
    { type: 'separator' },
    { label: 'Import from Chrome…', click: () => post(win.chrome.webContents, 'voyager:open-import') },
    { label: 'Manage profiles', click: () => post(win.chrome.webContents, 'voyager:open-profiles') }
  ]).popup({ window: win.window })
}

export function showTabMenu(win: VoyagerWindow, id: string): void {
  const tab = win.tabs.get(id)
  if (!tab) return
  Menu.buildFromTemplate([
    { label: 'Duplicate', click: () => win.tabs.duplicate(id) },
    { label: tab.state.pinned ? 'Unpin tab' : 'Pin tab', click: () => win.tabs.setPinned(id, !tab.state.pinned) },
    { label: tab.state.muted ? 'Unmute tab' : 'Mute tab', click: () => win.tabs.setMuted(id, !tab.state.muted) },
    { label: 'Add to group', submenu: [
      { label: 'New group', click: () => { const g = win.tabs.createGroup('New group', '#6366f1'); win.tabs.assign([id], g.id) } },
      ...win.tabs.groups.map((g) => ({ label: g.title, click: () => win.tabs.assign([id], g.id) })),
      { label: 'Remove from group', enabled: !!tab.state.groupId, click: () => win.tabs.assign([id], null) }
    ] },
    { type: 'separator' },
    { label: 'Close tab', click: () => win.tabs.close(id) }
  ]).popup({ window: win.window })
}

function zoomBy(win: VoyagerWindow | null, delta: number): void {
  const tab = win?.tabs.active()
  if (!tab) return
  win!.tabs.setZoom(tab.id, tab.view.webContents.getZoomLevel() + delta)
}

function cycleTab(win: VoyagerWindow | null, dir: number): void {
  if (!win) return
  const list = win.tabs.list()
  if (list.length < 2) return
  const i = list.findIndex((t) => t.id === win.tabs.activeId)
  const next = list[(i + dir + list.length) % list.length]
  win.tabs.activate(next.id)
}

function splitWithNext(win: VoyagerWindow | null): void {
  if (!win) return
  const list = win.tabs.list()
  const i = list.findIndex((t) => t.id === win.tabs.activeId)
  if (i < 0 || list.length < 2) return
  const next = list[(i + 1) % list.length]
  win.setSplit([list[i].id, next.id])
}

/** Right-click menu inside a page. */
export function showPageContextMenu(win: VoyagerWindow, tabId: string, params: Electron.ContextMenuParams): void {
  const tab = win.tabs.get(tabId)
  if (!tab) return
  const wc = tab.view.webContents
  const menu = new Menu()
  const ask = (prompt: string, skill?: string) => () => {
    win.toggleSidebar(true)
    post(win.chrome.webContents, 'voyager:ask', { prompt, skill, tabId })
  }

  if (params.selectionText) {
    const short = params.selectionText.trim().slice(0, 28)
    menu.append(new MenuItem({ label: `Ask Voyager about “${short}…”`, click: ask('') }))
    menu.append(new MenuItem({ label: 'Explain this', click: ask('', 'explain') }))
    menu.append(new MenuItem({ label: 'Rewrite this…', click: ask('', 'write') }))
    menu.append(new MenuItem({ type: 'separator' }))
    menu.append(new MenuItem({ role: 'copy' }))
    menu.append(new MenuItem({
      label: 'Search the web for this',
      click: () => win.tabs.create({ url: params.selectionText, background: false })
    }))
  } else {
    menu.append(new MenuItem({ label: 'Summarize this page', click: ask('', 'summary') }))
    menu.append(new MenuItem({ label: 'Ask Voyager about this page', click: ask('') }))
    menu.append(new MenuItem({ type: 'separator' }))
  }

  if (params.linkURL) {
    menu.append(new MenuItem({ type: 'separator' }))
    menu.append(new MenuItem({
      label: 'Open Link in New Tab',
      click: () => win.tabs.create({ url: params.linkURL, background: true })
    }))
    menu.append(new MenuItem({
      label: 'Open Link in Split',
      click: () => {
        const t = win.tabs.create({ url: params.linkURL, background: true })
        win.setSplit([tabId, t.id])
      }
    }))
    menu.append(new MenuItem({
      label: 'Copy Link', click: () => clipboard.writeText(params.linkURL)
    }))
    menu.append(new MenuItem({
      label: 'Open in Default Browser', click: () => openExternal(params.linkURL)
    }))
  }

  if (params.mediaType === 'image' && params.srcURL) {
    menu.append(new MenuItem({ type: 'separator' }))
    menu.append(new MenuItem({ label: 'Copy Image', click: () => wc.copyImageAt(params.x, params.y) }))
    menu.append(new MenuItem({
      label: 'Open Image in New Tab',
      click: () => win.tabs.create({ url: params.srcURL, background: true })
    }))
    menu.append(new MenuItem({ label: 'Save Image As…', click: () => wc.downloadURL(params.srcURL) }))
  }

  if (params.isEditable) {
    menu.append(new MenuItem({ type: 'separator' }))
    menu.append(new MenuItem({ role: 'cut' }))
    menu.append(new MenuItem({ role: 'paste' }))
    menu.append(new MenuItem({ label: 'Write with Voyager…', click: ask('', 'write') }))
    for (const suggestion of params.dictionarySuggestions.slice(0, 4)) {
      menu.append(new MenuItem({ label: suggestion, click: () => wc.replaceMisspelling(suggestion) }))
    }
  }

  menu.append(new MenuItem({ type: 'separator' }))
  menu.append(new MenuItem({ label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => win.tabs.back(tabId) }))
  menu.append(new MenuItem({ label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => win.tabs.forward(tabId) }))
  menu.append(new MenuItem({ label: 'Reload', click: () => win.tabs.reload(tabId) }))
  menu.append(new MenuItem({ type: 'separator' }))
  menu.append(new MenuItem({ label: 'Inspect Element', click: () => wc.inspectElement(params.x, params.y) }))

  menu.popup({ window: win.window })
}

/** Native edit menu for Voyager's own text fields, including reliable paste. */
export function showUiContextMenu(
  win: VoyagerWindow, wc: WebContents, params: Electron.ContextMenuParams
): void {
  if (!params.isEditable && !params.selectionText) return
  const menu = new Menu()
  if (params.isEditable) {
    menu.append(new MenuItem({ role: 'undo' }))
    menu.append(new MenuItem({ role: 'redo' }))
    menu.append(new MenuItem({ type: 'separator' }))
    menu.append(new MenuItem({ role: 'cut' }))
  }
  menu.append(new MenuItem({ role: 'copy' }))
  if (params.isEditable) {
    menu.append(new MenuItem({ role: 'paste' }))
    menu.append(new MenuItem({ role: 'pasteAndMatchStyle' }))
    menu.append(new MenuItem({ type: 'separator' }))
    menu.append(new MenuItem({ role: 'selectAll' }))
    for (const suggestion of params.dictionarySuggestions.slice(0, 4)) {
      menu.append(new MenuItem({ label: suggestion, click: () => wc.replaceMisspelling(suggestion) }))
    }
  }
  menu.popup({ window: win.window })
}

export function setAboutPanel(): void {
  app.setAboutPanelOptions({
    applicationName: 'Voyager',
    applicationVersion: app.getVersion(),
    credits: 'A local, AI-native browser.'
  })
}

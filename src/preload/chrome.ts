import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  Bookmark, Brief, ChatMessage, Conversation, ContextRef, HistoryEntry, MemoryItem,
  McpServerConfig, McpServerStatus, Profile, Settings, Skill, TabState, FullWindowState,
  DownloadEntry, SitePermission, SavedLogin, ExtensionStatus
} from '../shared/types'
import type { StreamEvent } from '../shared/ipc'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>
const send = (channel: string, ...args: unknown[]): void => { ipcRenderer.send(channel, ...args) }

/** Subscribe helper: returns an unsubscribe so React effects stay clean. */
function on<T>(channel: string, fn: (payload: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, payload: T): void => fn(payload)
  ipcRenderer.on(channel, handler)
  return () => { ipcRenderer.removeListener(channel, handler) }
}
/** Same, for main→renderer sends that carry no payload. */
function onBare(channel: string, fn: () => void): () => void {
  const handler = (): void => fn()
  ipcRenderer.on(channel, handler)
  return () => { ipcRenderer.removeListener(channel, handler) }
}

const api = {
  /** The chrome draws its own title bar, and the window controls are not on the
   *  same side on every platform. */
  platform: process.platform,

  // ——— tabs ————————————————————————————————————————————————
  tabs: {
    create: (opts?: { url?: string; background?: boolean; groupId?: string | null; index?: number }) =>
      send(IPC.tabCreate, opts ?? {}),
    close: (id: string) => send(IPC.tabClose, id),
    activate: (id: string) => send(IPC.tabActivate, id),
    reorder: (ids: string[]) => send(IPC.tabReorder, ids),
    navigate: (id: string, input: string) => send(IPC.tabNavigate, id, input),
    back: (id: string) => send(IPC.tabGoBack, id),
    forward: (id: string) => send(IPC.tabGoForward, id),
    reload: (id: string, hard = false) => send(IPC.tabReload, id, hard),
    stop: (id: string) => send(IPC.tabStop, id),
    mute: (id: string, muted: boolean) => send(IPC.tabMute, id, muted),
    pin: (id: string, pinned: boolean) => send(IPC.tabPin, id, pinned),
    duplicate: (id: string) => send(IPC.tabDuplicate, id),
    zoom: (id: string, level: number) => send(IPC.zoom, id, level),
    idle: (days: number) => invoke<TabState[]>(IPC.tabArchiveIdle, days)
  },

  // ——— groups ——————————————————————————————————————————————
  groups: {
    create: (title: string, color?: string) => send(IPC.groupCreate, title, color),
    update: (id: string, patch: Record<string, unknown>) => send(IPC.groupUpdate, id, patch),
    remove: (id: string, closeTabs = false) => send(IPC.groupDelete, id, closeTabs),
    assign: (tabIds: string[], groupId: string | null) => send(IPC.groupAssign, tabIds, groupId),
    autoOrganize: () => invoke<{ grouped: number; message: string }>(IPC.groupAutoOrganize)
  },

  // ——— layout ——————————————————————————————————————————————
  layout: {
    split: (ids: string[]) => send(IPC.splitSet, ids),
    clearSplit: () => send(IPC.splitClear),
    ratios: (r: number[]) => send(IPC.splitRatios, r),
    sidebar: (open?: boolean) => send(IPC.sidebarToggle, open),
    sidebarWidth: (px: number) => send(IPC.sidebarWidth, px),
    rail: (open?: boolean) => send(IPC.railToggle, open),
    railWidth: (px: number) => send(IPC.railWidth, px),
    state: () => invoke<FullWindowState>('kia:window-state')
  },

  // ——— overlay —————————————————————————————————————————————
  overlay: {
    open: (mode?: unknown) => send(IPC.paletteOpen, mode),
    close: () => send(IPC.paletteClose),
    onMode: (fn: (mode: unknown) => void) => on('kia:overlay-mode', fn)
  },

  // ——— profiles ————————————————————————————————————————————
  profiles: {
    list: () => invoke<Profile[]>(IPC.profileList),
    create: (name: string, color: string, persona: string) =>
      invoke<Profile>(IPC.profileCreate, name, color, persona),
    update: (id: string, patch: Partial<Profile>) => invoke<Profile[]>(IPC.profileUpdate, id, patch),
    switch: (id: string) => invoke<Profile | null>(IPC.profileSwitch, id),
    remove: (id: string) => invoke<Profile[]>(IPC.profileDelete, id)
  },

  // ——— chat ————————————————————————————————————————————————
  chat: {
    send: (payload: {
      conversationId: string | null; text: string; attachments: ContextRef[]; skillSlug?: string
    }) => invoke<{ started: true }>(IPC.chatSend, payload),
    stop: (messageId: string) => send(IPC.chatStop, messageId),
    conversations: () => invoke<Conversation[]>(IPC.chatConversations),
    history: (conversationId: string) => invoke<ChatMessage[]>(IPC.chatHistory, conversationId),
    create: () => invoke<Conversation>(IPC.chatNew),
    remove: (id: string) => invoke<Conversation[]>(IPC.chatDelete, id),
    approve: (stepId: string, approved: boolean) => send(IPC.approvalRespond, stepId, approved),
    onEvent: (fn: (e: StreamEvent) => void) => on<StreamEvent>(IPC.chatEvent, fn)
  },

  // ——— page context ————————————————————————————————————————
  page: {
    candidates: () => invoke<ContextRef[]>(IPC.contextCandidates),
    extract: (tabId?: string) =>
      invoke<{ url: string; title: string; byline: string | null; text: string; excluded?: boolean } | null>(
        IPC.pageExtract, tabId),
    selection: (tabId?: string) => invoke<string>(IPC.pageSelection, tabId),
    onSelectionChanged: (fn: (p: { tabId: string | null; url: string; hasSelection: boolean }) => void) =>
      on(IPC.pageSelectionChanged, fn)
  },

  // ——— writing tools ———————————————————————————————————————
  writing: {
    request: (instruction: string, tabId?: string) =>
      invoke<{ original: string; rewritten: string }>(IPC.writingRequest, instruction, tabId),
    apply: (text: string, replace = true, tabId?: string) =>
      invoke<boolean>(IPC.writingApply, text, replace, tabId)
  },

  // ——— skills ——————————————————————————————————————————————
  skills: {
    list: (query?: string) => invoke<Skill[]>(IPC.skillList, query),
    save: (skill: Partial<Skill>) => invoke<Skill[]>(IPC.skillSave, skill),
    remove: (id: string) => invoke<Skill[]>(IPC.skillDelete, id),
    reset: (slug: string) => invoke<Skill[]>('kia:skill-reset', slug),
    preview: (slug: string, input: string) =>
      invoke<{ prompt: string; attachments: ContextRef[] }>(IPC.skillRun, slug, input)
  },

  // ——— memory ——————————————————————————————————————————————
  memory: {
    list: () => invoke<MemoryItem[]>(IPC.memoryList),
    add: (text: string, kind: MemoryItem['kind']) => invoke<MemoryItem[]>(IPC.memoryAdd, text, kind),
    remove: (id: string) => invoke<MemoryItem[]>(IPC.memoryDelete, id),
    pin: (id: string, pinned: boolean) => invoke<MemoryItem[]>(IPC.memoryPin, id, pinned),
    clear: () => invoke<MemoryItem[]>(IPC.memoryClear)
  },

  // ——— history —————————————————————————————————————————————
  history: {
    search: (query: string, limit?: number) => invoke<HistoryEntry[]>(IPC.historySearch, query, limit),
    remove: (id: number) => invoke<boolean>(IPC.historyDelete, id),
    clear: (sinceIso?: string) => invoke<boolean>(IPC.historyClear, sinceIso),
    forgetDomain: (domain: string) => invoke<boolean>('kia:history-forget-domain', domain)
  },

  // ——— bookmarks ———————————————————————————————————————————
  bookmarks: {
    add: (url: string, title: string, folder?: string) =>
      invoke<Bookmark>(IPC.bookmarkAdd, url, title, folder),
    list: () => invoke<Bookmark[]>(IPC.bookmarkList),
    remove: (id: string) => invoke<Bookmark[]>(IPC.bookmarkDelete, id)
  },

  // ——— settings ————————————————————————————————————————————
  settings: {
    get: () => invoke<Settings>(IPC.settingsGet),
    set: (patch: Record<string, unknown>) => invoke<Settings>(IPC.settingsSet, patch),
    testKey: (key: string) => invoke<{ ok: boolean; error?: string }>(IPC.settingsTestKey, key),
    isExcluded: (url: string) => invoke<boolean>('kia:excluded', url)
  },

  /**
   * The opening: story, sound, or both. Non-null at most once per launch —
   * a second window opens to no fanfare. Null means skip it entirely.
   */
  opening: () => invoke<{
    story: boolean; volume: number
    open: Uint8Array | null; settle: Uint8Array | null
  } | null>(IPC.startupSound),
  splashDone: () => send(IPC.splashDone),

  // ——— connectors ——————————————————————————————————————————
  connectors: {
    status: () => invoke<McpServerStatus[]>(IPC.mcpStatus),
    save: (config: McpServerConfig) => invoke<McpServerStatus[]>(IPC.mcpSave, config),
    remove: (id: string) => invoke<McpServerStatus[]>(IPC.mcpDelete, id),
    reconnect: (id: string) => invoke<McpServerStatus[]>(IPC.mcpReconnect, id)
  },

  // ——— brief / decks ———————————————————————————————————————
  brief: {
    get: () => invoke<Brief | null>(IPC.briefGet),
    generate: () => invoke<Brief>(IPC.briefGenerate),
    onReady: (fn: (b: Brief) => void) => on<Brief>('kia:brief-ready', fn)
  },
  compose: {
    deck: (instruction: string) => invoke<{ path: string; title: string }>(IPC.deckGenerate, instruction),
    report: (instruction: string) => invoke<{ path: string; title: string }>(IPC.reportGenerate, instruction),
    reveal: (path: string) => invoke<boolean>('kia:reveal-file', path)
  },

  // ——— sync ————————————————————————————————————————————————
  sync: {
    chooseFolder: () => invoke<string | null>(IPC.syncChooseFolder),
    export: (folder: string, passphrase: string) => invoke<{ path: string }>(IPC.syncExport, folder, passphrase),
    import: (passphrase: string, path?: string) =>
      invoke<{ imported: Record<string, number> } | null>(IPC.syncImport, passphrase, path),
    filename: () => invoke<string>('kia:sync-filename')
  },

  // ——— downloads ———————————————————————————————————————————
  downloads: {
    list: () => invoke<DownloadEntry[]>(IPC.downloadsList),
    clear: () => invoke<DownloadEntry[]>('kia:downloads-clear'),
    onChanged: (fn: (d: DownloadEntry[]) => void) => on<DownloadEntry[]>('kia:downloads-changed', fn)
  },

  // ——— permissions —————————————————————————————————————————
  permissions: {
    /** The overlay's answer to one pending ask. */
    respond: (id: string, allowed: boolean, remember: boolean) =>
      send(IPC.permissionRespond, id, allowed, remember),
    /** null cancels the screen picker, which reads to the page as a refusal. */
    pickScreen: (sourceId: string | null) => send(IPC.screenPickRespond, sourceId),
    list: () => invoke<SitePermission[]>(IPC.permissionList),
    revoke: (origin: string, permission: string) =>
      invoke<SitePermission[]>(IPC.permissionRevoke, origin, permission),
    clear: () => invoke<SitePermission[]>(IPC.permissionClear)
  },

  // ——— saved logins ————————————————————————————————————————
  logins: {
    /** With a url, only what matches that origin. Never carries a password. */
    list: (url?: string) => invoke<SavedLogin[]>(IPC.loginList, url),
    save: (url: string, username: string, password: string) =>
      invoke<SavedLogin | null>(IPC.loginSave, url, username, password),
    /** Fills the active tab. The password goes main → page, never through here. */
    fill: (id: string) => invoke<boolean>(IPC.loginFill, id),
    remove: (id: string) => invoke<SavedLogin[]>(IPC.loginDelete, id),
    /** The one deliberate way to read a password back, for "show". */
    reveal: (id: string) => invoke<string | null>(IPC.loginReveal, id),
    respondSave: (accept: boolean) => send('kia:login-save-respond', accept)
  },

  // ——— extensions ——————————————————————————————————————————
  extensions: {
    list: () => invoke<ExtensionStatus[]>(IPC.extensionList),
    add: () => invoke<ExtensionStatus[]>(IPC.extensionAdd),
    remove: (path: string) => invoke<ExtensionStatus[]>(IPC.extensionRemove, path),
    toggle: (path: string, enabled: boolean) =>
      invoke<ExtensionStatus[]>(IPC.extensionToggle, path, enabled)
  },

  // ——— printing ————————————————————————————————————————————
  print: () => invoke<boolean>(IPC.printPage),
  printToPdf: () => invoke<string | null>(IPC.printToPdf),

  // ——— misc ————————————————————————————————————————————————
  openExternal: (url: string) => send(IPC.openExternal, url),
  openPanel: (name: string) => send('kia:open-panel', name),
  copy: (text: string) => invoke<boolean>('kia:clipboard-write', text),
  find: (text: string, forward = true) => send(IPC.findInPage, text, forward),
  pathForFile: (file: File) => webUtils.getPathForFile(file),

  // ——— main → renderer events ——————————————————————————————
  onState: (fn: (s: FullWindowState) => void) => on<FullWindowState>(IPC.stateChanged, fn),
  onLoadFailed: (fn: (p: { tabId: string; url: string; code: number; description: string }) => void) =>
    on('kia:load-failed', fn),
  onTabCrashed: (fn: (p: { tabId: string }) => void) => on('kia:tab-crashed', fn),
  onAsk: (fn: (p: { prompt: string; skill?: string; tabId?: string }) => void) => on('kia:ask', fn),
  onToast: (fn: (p: { message: string; kind?: 'info' | 'error' }) => void) => on('kia:toast', fn),
  onPaused: (fn: (paused: boolean) => void) => on<boolean>('kia:set-paused', fn),

  // Menu-driven navigation. Each returns an unsubscribe.
  onOpen: (
    what:
      | 'settings' | 'privacy' | 'history' | 'bookmarks' | 'memory' | 'skills' | 'connectors'
      | 'brief' | 'deck-composer' | 'shortcuts' | 'find' | 'tidy',
    fn: () => void
  ) => onBare(`kia:open-${what}`, fn),
  onFocus: (what: 'omnibox' | 'composer', fn: () => void) => onBare(`kia:focus-${what}`, fn),
  onReopenClosedTab: (fn: () => void) => onBare('kia:reopen-closed-tab', fn),
  onAutoOrganize: (fn: () => void) => onBare('kia:auto-organize', fn),
  onPrintPdf: (fn: () => void) => onBare('kia:print-pdf', fn),
}

export type KiaApi = typeof api

contextBridge.exposeInMainWorld('kia', api)

/**
 * Every channel with a reply — anything the preload reaches with `invoke`, or
 * `send`s and expects main to act on — belongs here, so main and renderer cannot
 * drift on a name. One-way notifications main pushes at the chrome are a
 * name-derived family instead (`voyager:open-<panel>`, `voyager:focus-<target>`), built
 * from the panel name in both directions; see `openPanel` in `ipc.ts` and the
 * panel list in `App.tsx`.
 */
export const IPC = {
  securityStatus: 'voyager:security-status',
  securityUpdate: 'voyager:security-update',
  securityRefreshThreats: 'voyager:security-refresh-threats',
  // window + chrome
  stateChanged: 'voyager:state-changed',
  windowState: 'voyager:window-state',
  // tabs
  tabCreate: 'voyager:tab-create',
  tabClose: 'voyager:tab-close',
  tabActivate: 'voyager:tab-activate',
  tabReorder: 'voyager:tab-reorder',
  tabNavigate: 'voyager:tab-navigate',
  tabGoBack: 'voyager:tab-back',
  tabGoForward: 'voyager:tab-forward',
  tabReload: 'voyager:tab-reload',
  tabStop: 'voyager:tab-stop',
  tabMute: 'voyager:tab-mute',
  tabPin: 'voyager:tab-pin',
  tabDuplicate: 'voyager:tab-duplicate',
  tabArchiveIdle: 'voyager:tab-archive-idle',
  // groups
  groupCreate: 'voyager:group-create',
  groupUpdate: 'voyager:group-update',
  groupDelete: 'voyager:group-delete',
  groupAssign: 'voyager:group-assign',
  groupAutoOrganize: 'voyager:group-auto-organize',
  // splits
  splitSet: 'voyager:split-set',
  splitClear: 'voyager:split-clear',
  splitRatios: 'voyager:split-ratios',
  // profiles
  profileList: 'voyager:profile-list',
  profileCreate: 'voyager:profile-create',
  profileSwitch: 'voyager:profile-switch',
  profileUpdate: 'voyager:profile-update',
  profileDelete: 'voyager:profile-delete',
  // sidebar / overlay
  sidebarToggle: 'voyager:sidebar-toggle',
  sidebarWidth: 'voyager:sidebar-width',
  railToggle: 'voyager:rail-toggle',
  railWidth: 'voyager:rail-width',
  paletteOpen: 'voyager:palette-open',
  paletteClose: 'voyager:palette-close',
  // chat
  chatSend: 'voyager:chat-send',
  chatStop: 'voyager:chat-stop',
  chatEvent: 'voyager:chat-event',
  chatHistory: 'voyager:chat-history',
  chatConversations: 'voyager:chat-conversations',
  chatNew: 'voyager:chat-new',
  chatDelete: 'voyager:chat-delete',
  approvalRespond: 'voyager:approval-respond',
  // context
  contextCandidates: 'voyager:context-candidates',
  pageExtract: 'voyager:page-extract',
  pageSelection: 'voyager:page-selection',
  pageSelectionChanged: 'voyager:page-selection-changed',
  writingApply: 'voyager:writing-apply',
  writingRequest: 'voyager:writing-request',
  // skills
  skillList: 'voyager:skill-list',
  skillSave: 'voyager:skill-save',
  skillDelete: 'voyager:skill-delete',
  skillRun: 'voyager:skill-run',
  skillReset: 'voyager:skill-reset',
  // memory
  memoryList: 'voyager:memory-list',
  memoryDelete: 'voyager:memory-delete',
  memoryAdd: 'voyager:memory-add',
  memoryClear: 'voyager:memory-clear',
  memoryPin: 'voyager:memory-pin',
  // history
  historySearch: 'voyager:history-search',
  historyDelete: 'voyager:history-delete',
  historyClear: 'voyager:history-clear',
  historyForgetDomain: 'voyager:history-forget-domain',
  // settings
  settingsGet: 'voyager:settings-get',
  settingsSet: 'voyager:settings-set',
  settingsTestKey: 'voyager:settings-test-key',
  startupSound: 'voyager:startup-sound',
  splashDone: 'voyager:splash-done',
  // permissions
  permissionRespond: 'voyager:permission-respond',
  permissionList: 'voyager:permission-list',
  permissionRevoke: 'voyager:permission-revoke',
  permissionClear: 'voyager:permission-clear',
  screenPickRespond: 'voyager:screen-pick-respond',
  // passwords
  loginList: 'voyager:login-list',
  loginSave: 'voyager:login-save',
  loginFill: 'voyager:login-fill',
  loginDelete: 'voyager:login-delete',
  loginReveal: 'voyager:login-reveal',
  loginPrompt: 'voyager:login-prompt',
  // extensions
  extensionList: 'voyager:extension-list',
  extensionAdd: 'voyager:extension-add',
  extensionRemove: 'voyager:extension-remove',
  extensionToggle: 'voyager:extension-toggle',
  // printing
  printPage: 'voyager:print-page',
  printToPdf: 'voyager:print-to-pdf',
  // connectors
  mcpStatus: 'voyager:mcp-status',
  mcpSave: 'voyager:mcp-save',
  mcpDelete: 'voyager:mcp-delete',
  mcpReconnect: 'voyager:mcp-reconnect',
  // brief
  briefGet: 'voyager:brief-get',
  briefGenerate: 'voyager:brief-generate',
  // decks / reports
  deckGenerate: 'voyager:deck-generate',
  reportGenerate: 'voyager:report-generate',
  revealFile: 'voyager:reveal-file',
  // sync
  syncExport: 'voyager:sync-export',
  syncImport: 'voyager:sync-import',
  syncChooseFolder: 'voyager:sync-choose-folder',
  syncFilename: 'voyager:sync-filename',
  // misc
  openExternal: 'voyager:open-external',
  bookmarkAdd: 'voyager:bookmark-add',
  bookmarkList: 'voyager:bookmark-list',
  bookmarkDelete: 'voyager:bookmark-delete',
  bookmarkShortcutAdd: 'voyager:bookmark-shortcut-add',
  bookmarkShortcutSet: 'voyager:bookmark-shortcut-set',
  bookmarkOpen: 'voyager:bookmark-open',
  bookmarksChanged: 'voyager:bookmarks-changed',
  downloadsList: 'voyager:downloads-list',
  downloadsClear: 'voyager:downloads-clear',
  clipboardWrite: 'voyager:clipboard-write',
  excluded: 'voyager:excluded',
  findInPage: 'voyager:find-in-page',
  zoom: 'voyager:zoom'
} as const

export type StreamEvent =
  | { type: 'start'; conversationId: string; messageId: string }
  | { type: 'thinking'; messageId: string; delta: string }
  | { type: 'text'; messageId: string; delta: string }
  | { type: 'step'; messageId: string; step: import('./types').ToolStep }
  | { type: 'approval'; messageId: string; step: import('./types').ToolStep }
  | { type: 'citations'; messageId: string; citations: import('./types').Citation[] }
  | { type: 'done'; messageId: string; usage?: { input: number; output: number; cacheRead: number } }
  | { type: 'error'; messageId: string; message: string }

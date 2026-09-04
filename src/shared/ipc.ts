/**
 * Every channel with a reply — anything the preload reaches with `invoke`, or
 * `send`s and expects main to act on — belongs here, so main and renderer cannot
 * drift on a name. One-way notifications main pushes at the chrome are a
 * name-derived family instead (`kia:open-<panel>`, `kia:focus-<target>`), built
 * from the panel name in both directions; see `openPanel` in `ipc.ts` and the
 * panel list in `App.tsx`.
 */
export const IPC = {
  // window + chrome
  stateChanged: 'kia:state-changed',
  // tabs
  tabCreate: 'kia:tab-create',
  tabClose: 'kia:tab-close',
  tabActivate: 'kia:tab-activate',
  tabReorder: 'kia:tab-reorder',
  tabNavigate: 'kia:tab-navigate',
  tabGoBack: 'kia:tab-back',
  tabGoForward: 'kia:tab-forward',
  tabReload: 'kia:tab-reload',
  tabStop: 'kia:tab-stop',
  tabMute: 'kia:tab-mute',
  tabPin: 'kia:tab-pin',
  tabDuplicate: 'kia:tab-duplicate',
  tabArchiveIdle: 'kia:tab-archive-idle',
  // groups
  groupCreate: 'kia:group-create',
  groupUpdate: 'kia:group-update',
  groupDelete: 'kia:group-delete',
  groupAssign: 'kia:group-assign',
  groupAutoOrganize: 'kia:group-auto-organize',
  // splits
  splitSet: 'kia:split-set',
  splitClear: 'kia:split-clear',
  splitRatios: 'kia:split-ratios',
  // profiles
  profileList: 'kia:profile-list',
  profileCreate: 'kia:profile-create',
  profileSwitch: 'kia:profile-switch',
  profileUpdate: 'kia:profile-update',
  profileDelete: 'kia:profile-delete',
  // sidebar / overlay
  sidebarToggle: 'kia:sidebar-toggle',
  sidebarWidth: 'kia:sidebar-width',
  paletteOpen: 'kia:palette-open',
  paletteClose: 'kia:palette-close',
  // chat
  chatSend: 'kia:chat-send',
  chatStop: 'kia:chat-stop',
  chatEvent: 'kia:chat-event',
  chatHistory: 'kia:chat-history',
  chatConversations: 'kia:chat-conversations',
  chatNew: 'kia:chat-new',
  chatDelete: 'kia:chat-delete',
  approvalRespond: 'kia:approval-respond',
  // context
  contextCandidates: 'kia:context-candidates',
  pageExtract: 'kia:page-extract',
  pageSelection: 'kia:page-selection',
  pageSelectionChanged: 'kia:page-selection-changed',
  writingApply: 'kia:writing-apply',
  writingRequest: 'kia:writing-request',
  // skills
  skillList: 'kia:skill-list',
  skillSave: 'kia:skill-save',
  skillDelete: 'kia:skill-delete',
  skillRun: 'kia:skill-run',
  // memory
  memoryList: 'kia:memory-list',
  memoryDelete: 'kia:memory-delete',
  memoryAdd: 'kia:memory-add',
  memoryClear: 'kia:memory-clear',
  memoryPin: 'kia:memory-pin',
  // history
  historySearch: 'kia:history-search',
  historyDelete: 'kia:history-delete',
  historyClear: 'kia:history-clear',
  // settings
  settingsGet: 'kia:settings-get',
  settingsSet: 'kia:settings-set',
  settingsTestKey: 'kia:settings-test-key',
  startupSound: 'kia:startup-sound',
  splashDone: 'kia:splash-done',
  // permissions
  permissionRespond: 'kia:permission-respond',
  permissionList: 'kia:permission-list',
  permissionRevoke: 'kia:permission-revoke',
  permissionClear: 'kia:permission-clear',
  screenPickRespond: 'kia:screen-pick-respond',
  // passwords
  loginList: 'kia:login-list',
  loginSave: 'kia:login-save',
  loginFill: 'kia:login-fill',
  loginDelete: 'kia:login-delete',
  loginReveal: 'kia:login-reveal',
  loginPrompt: 'kia:login-prompt',
  // extensions
  extensionList: 'kia:extension-list',
  extensionAdd: 'kia:extension-add',
  extensionRemove: 'kia:extension-remove',
  extensionToggle: 'kia:extension-toggle',
  // printing
  printPage: 'kia:print-page',
  printToPdf: 'kia:print-to-pdf',
  // connectors
  mcpStatus: 'kia:mcp-status',
  mcpSave: 'kia:mcp-save',
  mcpDelete: 'kia:mcp-delete',
  mcpReconnect: 'kia:mcp-reconnect',
  // brief
  briefGet: 'kia:brief-get',
  briefGenerate: 'kia:brief-generate',
  // decks / reports
  deckGenerate: 'kia:deck-generate',
  reportGenerate: 'kia:report-generate',
  // sync
  syncExport: 'kia:sync-export',
  syncImport: 'kia:sync-import',
  syncChooseFolder: 'kia:sync-choose-folder',
  // misc
  openExternal: 'kia:open-external',
  bookmarkAdd: 'kia:bookmark-add',
  bookmarkList: 'kia:bookmark-list',
  bookmarkDelete: 'kia:bookmark-delete',
  downloadsList: 'kia:downloads-list',
  findInPage: 'kia:find-in-page',
  zoom: 'kia:zoom'
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

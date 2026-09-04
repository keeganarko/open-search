/** Shared contract between main, preload and renderer. No runtime imports. */

export type ActionClass =
  | 'read'              // inspect scoped browser/connector data
  | 'local_reversible'  // organize tabs, write local notes
  | 'external_draft'    // prepare an email/issue without sending
  | 'external_write'    // send, publish, create, edit
  | 'sensitive'         // purchases, credentials, deletion, financial

export interface TabState {
  id: string
  profileId: string
  groupId: string | null
  url: string
  title: string
  favicon: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  audible: boolean
  muted: boolean
  pinned: boolean
  index: number
  /** ISO date this tab was last activated — drives "tidy" and archiving. */
  lastActiveAt: string
  createdAt: string
}

export interface TabGroup {
  id: string
  profileId: string
  title: string
  color: string
  collapsed: boolean
  /** Set when the group was created automatically from a calendar event. */
  meeting: MeetingMeta | null
  createdAt: string
}

export interface MeetingMeta {
  eventTitle: string
  startsAt: string | null
  endsAt: string | null
  source: string
}

export interface Profile {
  id: string
  name: string
  color: string
  /** Electron session partition, e.g. persist:kia-work */
  partition: string
  /** Per-profile system prompt fragment given to the assistant. */
  persona: string
  createdAt: string
}

export interface SplitLayout {
  /** Ordered tab ids shown side by side in the content area. */
  tabIds: string[]
  /** Fractional widths, same length as tabIds, summing to 1. */
  ratios: number[]
}

export interface WindowState {
  profileId: string
  activeTabId: string | null
  split: SplitLayout | null
  sidebarOpen: boolean
  sidebarWidth: number
}

// ——— Skills ———————————————————————————————————————————————

export interface Skill {
  id: string
  /** Slash trigger, without the slash. e.g. "summary" -> /summary */
  slug: string
  name: string
  description: string
  /** Prompt template. Supports {{selection}} {{page}} {{tabs}} {{input}} {{url}} */
  prompt: string
  /** Which context the skill pulls in automatically. */
  context: SkillContext
  model: string | null
  /** Built-ins ship with Open Search and can be reset but not deleted. */
  builtin: boolean
  /** Optional global hotkey, e.g. "Cmd+Shift+S" */
  hotkey: string | null
  createdAt: string
  updatedAt: string
}

export interface SkillContext {
  currentPage: boolean
  allTabs: boolean
  selection: boolean
  history: boolean
  memory: boolean
  connectors: boolean
}

// ——— Memory ———————————————————————————————————————————————

export type MemoryKind = 'preference' | 'fact' | 'project' | 'person' | 'contact'

export interface MemoryItem {
  id: string
  profileId: string
  kind: MemoryKind
  /** One assertion. */
  text: string
  /** Where it came from: a url, "chat", or a skill slug. */
  source: string
  /** 0..1 — how sure Open Search is. Written facts from the user are 1. */
  confidence: number
  /** ISO date after which the fact should be re-verified. */
  expiresAt: string | null
  pinned: boolean
  createdAt: string
  lastUsedAt: string | null
  useCount: number
}

// ——— History ——————————————————————————————————————————————

export interface HistoryEntry {
  id: number
  profileId: string
  url: string
  title: string
  /** Extracted readable text, capped. Only stored when the site is not excluded. */
  excerpt: string | null
  visitedAt: string
  dwellMs: number
}

// ——— Chat —————————————————————————————————————————————————

export interface Conversation {
  id: string
  profileId: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface ChatMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  /** Rendered text. Tool activity lives in `steps`. */
  text: string
  thinking: string | null
  steps: ToolStep[]
  citations: Citation[]
  attachments: ContextRef[]
  error: string | null
  createdAt: string
}

export interface ToolStep {
  id: string
  name: string
  input: unknown
  output: string | null
  actionClass: ActionClass
  status: 'pending' | 'awaiting_approval' | 'running' | 'done' | 'error' | 'denied'
  startedAt: string
  endedAt: string | null
}

export interface Citation {
  title: string
  url: string
  favicon?: string | null
  snippet?: string
}

/** A thing the user @-mentioned into the chat. */
export interface ContextRef {
  type: 'tab' | 'group' | 'selection' | 'history' | 'file' | 'connector'
  id: string
  label: string
  detail?: string
}

// ——— Connectors (MCP) ——————————————————————————————————————

export interface McpServerConfig {
  id: string
  name: string
  enabled: boolean
  transport: 'stdio' | 'http'
  /** stdio */
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** http */
  url?: string
  headers?: Record<string, string>
}

export interface McpServerStatus {
  id: string
  name: string
  connected: boolean
  error: string | null
  toolCount: number
  tools: { name: string; description: string; actionClass: ActionClass }[]
}

// ——— Settings —————————————————————————————————————————————

export interface Settings {
  ai: {
    provider: 'anthropic'
    model: string
    apiKey: string | null
    effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    showThinking: boolean
    /** Send page text to the model only after this is true. */
    contextConsent: boolean
  }
  privacy: {
    blockAds: boolean
    blockTrackers: boolean
    /** Domains never read, never stored, never sent to the model. */
    excludedDomains: string[]
    historyRetentionDays: number
    memoryEnabled: boolean
    /** Global kill switch — no page content leaves the machine. */
    paused: boolean
    sendDoNotTrack: boolean
    clearOnQuit: boolean
  }
  appearance: {
    theme: 'system' | 'light' | 'dark'
    accent: string
    /** Show the tab strip above or hide it in favour of the command bar. */
    compactChrome: boolean
    /** Play the opening theme when the first window appears. */
    startupSound: boolean
    /** Show the scribbled opening story on the first window. */
    startupStory: boolean
    /** 0–1. Applies to the opening theme only. */
    startupVolume: number
  }
  search: {
    engine: 'google' | 'duckduckgo' | 'brave' | 'kagi'
    /** When a query looks like a question, offer Ask Open Search first. */
    askFirst: boolean
  }
  brief: {
    enabled: boolean
    /** Local time HH:MM the brief becomes available. */
    at: string
    includeCalendar: boolean
    includeMail: boolean
    includeTabs: boolean
    includeReadingList: boolean
  }
  approvals: {
    /** Action classes that may run without asking, inside an active request. */
    auto: ActionClass[]
  }
  sync: {
    /** Directory the encrypted bundle is written to (e.g. iCloud Drive). */
    folder: string | null
    passphraseSet: boolean
    lastExportAt: string | null
  }
}

// ——— Morning Brief —————————————————————————————————————————

export interface Brief {
  id: string
  profileId: string
  date: string
  sections: BriefSection[]
  generatedAt: string
}

export interface BriefSection {
  title: string
  /** Markdown. */
  body: string
  items: BriefItem[]
}

export interface BriefItem {
  label: string
  detail: string | null
  url: string | null
  at: string | null
}

export interface Bookmark {
  id: string
  profile_id: string
  url: string
  title: string
  folder: string | null
  created_at: string
}

/** What the main process actually pushes on `kia:state-changed`. */
export interface FullWindowState extends WindowState {
  tabs: TabState[]
  groups: TabGroup[]
  profile: Profile
  profiles: Profile[]
}

// ——— Site permissions ——————————————————————————————————————

/**
 * The permission strings are Chromium's own, passed straight through from
 * `setPermissionRequestHandler`. Open Search does not invent its own vocabulary here.
 */
export interface SitePermission {
  /** Scheme + host + port, e.g. https://meet.google.com */
  origin: string
  permission: string
  allowed: boolean
  decidedAt: string
}

/** What the prompt sheet is told about a pending request. */
export interface PermissionAsk {
  id: string
  origin: string
  permission: string
  /** Present for `media`: which of camera/microphone the page actually wants. */
  mediaTypes?: string[]
}

// ——— Extensions ————————————————————————————————————————————

export interface ExtensionStatus {
  /** Absolute path to the unpacked extension directory. */
  path: string
  enabled: boolean
  name: string
  version: string
  manifestVersion: number
  addedAt: string
  /** Whether it is actually running in at least one profile right now. */
  loaded: boolean
  error: string | null
}

// ——— Saved logins ——————————————————————————————————————————

/** Never carries the password. Filling one is a separate, explicit call. */
export interface SavedLogin {
  id: string
  origin: string
  username: string
  createdAt: string
  updatedAt: string
  usedAt: string | null
}

export interface DownloadEntry {
  id: string
  filename: string
  path: string
  url: string
  bytes: number
  received: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted' | 'paused'
  startedAt: string
}

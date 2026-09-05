import { hasSecureStorage } from './secureStorage'
import Database from 'better-sqlite3'
import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { databaseKey } from './databaseKey'
import { openEncryptedDatabase } from './encryptedDatabase'
import { MAX_SHORTCUTS, STARTER_SHORTCUTS, shortcutUrl } from '@shared/bookmarks'
import type { ImportCounts } from '@shared/browserImport'
import type { ImportedBookmark, ImportedHistory, ImportedPassword } from '../browser/importParsers'
import type {
  MemoryItem, MemoryKind, Skill, HistoryEntry, Conversation, ChatMessage,
  Profile, TabGroup, McpServerConfig, Brief, Bookmark, SitePermission, SavedLogin
} from '@shared/types'

let db: Database.Database

export function openDb(): Database.Database {
  if (db) return db
  const key = databaseKey()
  try { db = openEncryptedDatabase(join(app.getPath('userData'), 'voyager.db'), key) }
  finally { key.fill(0) }
  migrate()
  return db
}

function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
      partition TEXT NOT NULL, persona TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tab_groups (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      title TEXT NOT NULL, color TEXT NOT NULL,
      collapsed INTEGER NOT NULL DEFAULT 0,
      meeting_json TEXT, created_at TEXT NOT NULL
    );

    -- Restored on launch; live tab state lives in TabManager, not here.
    CREATE TABLE IF NOT EXISTS saved_tabs (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      group_id TEXT, url TEXT NOT NULL, title TEXT NOT NULL,
      favicon TEXT, pinned INTEGER NOT NULL DEFAULT 0,
      idx INTEGER NOT NULL, last_active_at TEXT NOT NULL, created_at TEXT NOT NULL,
      -- Which window these belong to. Restore is per window, not per profile,
      -- or a second window would re-open the first one's tabs.
      window_key TEXT NOT NULL DEFAULT 'w1'
    );

    -- Recently closed navigation stacks. Page state is deliberately omitted:
    -- Chromium pageState can contain form values, which do not belong in SQLite.
    CREATE TABLE IF NOT EXISTS closed_tabs (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, window_key TEXT NOT NULL,
      entries_json TEXT NOT NULL, active_index INTEGER NOT NULL,
      group_id TEXT, closed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS closed_tabs_recent
      ON closed_tabs(profile_id, window_key, closed_at DESC);

    CREATE TABLE IF NOT EXISTS zoom_levels (
      profile_id TEXT NOT NULL, origin TEXT NOT NULL, level REAL NOT NULL,
      PRIMARY KEY(profile_id, origin)
    );

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL,
      excerpt TEXT, visited_at TEXT NOT NULL, dwell_ms INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS history_visited ON history(visited_at DESC);
    CREATE INDEX IF NOT EXISTS history_url ON history(url);

    CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(
      title, excerpt, url, content='history', content_rowid='id', tokenize='porter unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS history_ai AFTER INSERT ON history BEGIN
      INSERT INTO history_fts(rowid, title, excerpt, url)
      VALUES (new.id, new.title, coalesce(new.excerpt,''), new.url);
    END;
    CREATE TRIGGER IF NOT EXISTS history_ad AFTER DELETE ON history BEGIN
      INSERT INTO history_fts(history_fts, rowid, title, excerpt, url)
      VALUES ('delete', old.id, old.title, coalesce(old.excerpt,''), old.url);
    END;
    CREATE TRIGGER IF NOT EXISTS history_au AFTER UPDATE ON history BEGIN
      INSERT INTO history_fts(history_fts, rowid, title, excerpt, url)
      VALUES ('delete', old.id, old.title, coalesce(old.excerpt,''), old.url);
      INSERT INTO history_fts(rowid, title, excerpt, url)
      VALUES (new.id, new.title, coalesce(new.excerpt,''), new.url);
    END;

    CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL,
      kind TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.7, expires_at TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, last_used_at TEXT, use_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS memory_profile ON memory(profile_id);

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      description TEXT NOT NULL, prompt TEXT NOT NULL, context_json TEXT NOT NULL,
      model TEXT, builtin INTEGER NOT NULL DEFAULT 0, hotkey TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, title TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL, text TEXT NOT NULL, thinking TEXT,
      steps_json TEXT NOT NULL DEFAULT '[]',
      citations_json TEXT NOT NULL DEFAULT '[]',
      attachments_json TEXT NOT NULL DEFAULT '[]',
      error TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_conv ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, url TEXT NOT NULL,
      title TEXT NOT NULL, folder TEXT, created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY, config_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS briefs (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, date TEXT NOT NULL,
      sections_json TEXT NOT NULL, generated_at TEXT NOT NULL,
      UNIQUE(profile_id, date)
    );

    -- One row per (origin, permission) the user has answered for. Absence means
    -- "never asked", which is what makes the prompt appear.
    CREATE TABLE IF NOT EXISTS site_permissions (
      profile_id TEXT NOT NULL, origin TEXT NOT NULL, permission TEXT NOT NULL,
      allowed INTEGER NOT NULL, decided_at TEXT NOT NULL,
      PRIMARY KEY (profile_id, origin, permission)
    );

    -- password_enc is a safeStorage blob, never plaintext. The row is keyed on
    -- origin+username so a second account on one site is a second row.
    CREATE TABLE IF NOT EXISTS logins (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, origin TEXT NOT NULL,
      username TEXT NOT NULL, password_enc TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, used_at TEXT,
      UNIQUE(profile_id, origin, username)
    );
    CREATE INDEX IF NOT EXISTS logins_origin ON logins(profile_id, origin);
  `)

  addColumn('saved_tabs', 'window_key', "TEXT NOT NULL DEFAULT 'w1'")
  addColumn('bookmarks', 'shortcut', 'INTEGER NOT NULL DEFAULT 0')
  db.exec('CREATE INDEX IF NOT EXISTS bookmarks_profile_url ON bookmarks(profile_id,url); CREATE INDEX IF NOT EXISTS history_import_match ON history(profile_id,url,visited_at)')
}

/**
 * The schema is otherwise all CREATE TABLE IF NOT EXISTS, which cannot add a
 * column to a table that already exists on someone's disk. This does that, and
 * is a no-op once the column is there.
 */
function addColumn(table: string, column: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (cols.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`)
}

// ——— kv ————————————————————————————————————————————————————

export function kvGet<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
  if (!row) return fallback
  try { return JSON.parse(row.value) as T } catch { return fallback }
}

export function kvSet(key: string, value: unknown): void {
  db.prepare('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, JSON.stringify(value))
}

// ——— profiles ——————————————————————————————————————————————

const rowToProfile = (r: any): Profile => ({
  id: r.id, name: r.name, color: r.color, partition: r.partition,
  persona: r.persona, createdAt: r.created_at
})

export function listProfiles(): Profile[] {
  return (db.prepare('SELECT * FROM profiles ORDER BY created_at').all() as any[]).map(rowToProfile)
}

export function createProfile(name: string, color: string, persona = ''): Profile {
  const id = randomUUID()
  const p: Profile = {
    id, name, color, partition: `persist:voyager-${id}`, persona,
    createdAt: new Date().toISOString()
  }
  db.prepare(
    'INSERT INTO profiles(id,name,color,partition,persona,created_at) VALUES(?,?,?,?,?,?)'
  ).run(p.id, p.name, p.color, p.partition, p.persona, p.createdAt)
  return p
}

export function updateProfile(id: string, patch: Partial<Profile>): void {
  const cur = (db.prepare('SELECT * FROM profiles WHERE id=?').get(id) as any)
  if (!cur) return
  db.prepare('UPDATE profiles SET name=?, color=?, persona=? WHERE id=?')
    .run(patch.name ?? cur.name, patch.color ?? cur.color, patch.persona ?? cur.persona, id)
}

export function deleteProfile(id: string): void {
  // Most of the original schema predates foreign keys. Keep this explicit even
  // after adding constraints so old databases and new databases erase exactly
  // the same profile-owned data, including saved passwords and chat messages.
  const erase = db.transaction((profileId: string) => {
    db.prepare(`DELETE FROM messages WHERE conversation_id IN
      (SELECT id FROM conversations WHERE profile_id=?)`).run(profileId)
    for (const table of [
      'conversations', 'history', 'memory', 'bookmarks', 'briefs',
      'site_permissions', 'logins', 'closed_tabs', 'zoom_levels',
      'saved_tabs', 'tab_groups'
    ]) {
      db.prepare(`DELETE FROM ${table} WHERE profile_id=?`).run(profileId)
    }
    db.prepare('DELETE FROM profiles WHERE id=?').run(profileId)
    db.prepare('DELETE FROM kv WHERE key=?').run(`bookmark-shortcuts-initialized:${profileId}`)
    db.prepare('DELETE FROM kv WHERE key=?').run(`agents:definitions:${profileId}`)
    db.prepare('DELETE FROM kv WHERE key=?').run(`agents:runs:${profileId}`)
  })
  erase(id)
}

export function ensureDefaultProfile(): Profile {
  const existing = listProfiles()
  if (existing.length) return existing[0]
  return createProfile('Personal', '#6366f1')
}

// ——— tab groups ————————————————————————————————————————————

const rowToGroup = (r: any): TabGroup => ({
  id: r.id, profileId: r.profile_id, title: r.title, color: r.color,
  collapsed: !!r.collapsed, meeting: r.meeting_json ? JSON.parse(r.meeting_json) : null,
  createdAt: r.created_at
})

export function listGroups(profileId: string): TabGroup[] {
  return (db.prepare('SELECT * FROM tab_groups WHERE profile_id=? ORDER BY created_at').all(profileId) as any[])
    .map(rowToGroup)
}

export function upsertGroup(g: TabGroup): void {
  db.prepare(`INSERT INTO tab_groups(id,profile_id,title,color,collapsed,meeting_json,created_at)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, color=excluded.color,
      collapsed=excluded.collapsed, meeting_json=excluded.meeting_json`)
    .run(g.id, g.profileId, g.title, g.color, g.collapsed ? 1 : 0,
         g.meeting ? JSON.stringify(g.meeting) : null, g.createdAt)
}

export function deleteGroup(id: string): void {
  db.prepare('DELETE FROM tab_groups WHERE id=?').run(id)
}

// ——— saved tabs (session restore) ——————————————————————————

export interface SavedTab {
  id: string; profileId: string; groupId: string | null; url: string
  title: string; favicon: string | null; pinned: boolean; index: number
  lastActiveAt: string; createdAt: string
}

export function replaceSavedTabs(
  profileId: string, windowKey: string, tabs: SavedTab[]
): void {
  const tx = db.transaction((rows: SavedTab[]) => {
    db.prepare('DELETE FROM saved_tabs WHERE profile_id=? AND window_key=?')
      .run(profileId, windowKey)
    const ins = db.prepare(`INSERT INTO saved_tabs
      (id,profile_id,group_id,url,title,favicon,pinned,idx,last_active_at,created_at,window_key)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    for (const t of rows) {
      ins.run(t.id, t.profileId, t.groupId, t.url, t.title, t.favicon,
              t.pinned ? 1 : 0, t.index, t.lastActiveAt, t.createdAt, windowKey)
    }
  })
  tx(tabs)
}

export function loadSavedTabs(profileId: string, windowKey: string): SavedTab[] {
  return (db.prepare(
    'SELECT * FROM saved_tabs WHERE profile_id=? AND window_key=? ORDER BY idx'
  ).all(profileId, windowKey) as any[])
    .map((r) => ({
      id: r.id, profileId: r.profile_id, groupId: r.group_id, url: r.url,
      title: r.title, favicon: r.favicon, pinned: !!r.pinned, index: r.idx,
      lastActiveAt: r.last_active_at, createdAt: r.created_at
    }))
}

/** One key per window that had tabs when the app last quit, oldest first. */
export function listSavedWindowKeys(profileId: string): string[] {
  return (db.prepare(
    `SELECT window_key, MIN(created_at) AS first FROM saved_tabs
     WHERE profile_id=? GROUP BY window_key ORDER BY first`
  ).all(profileId) as { window_key: string }[]).map((r) => r.window_key)
}

/** A window the user closed on purpose should not come back next launch. */
export function dropSavedWindow(profileId: string, windowKey: string): void {
  db.prepare('DELETE FROM saved_tabs WHERE profile_id=? AND window_key=?')
    .run(profileId, windowKey)
}

export interface ClosedTab {
  entries: { title: string; url: string }[]
  activeIndex: number
  groupId: string | null
}

export function rememberClosedTab(
  profileId: string,
  windowKey: string,
  tab: ClosedTab
): void {
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO closed_tabs
      (id,profile_id,window_key,entries_json,active_index,group_id,closed_at)
      VALUES(?,?,?,?,?,?,?)`)
      .run(randomUUID(), profileId, windowKey, JSON.stringify(tab.entries),
        tab.activeIndex, tab.groupId, new Date().toISOString())
    db.prepare(`DELETE FROM closed_tabs WHERE id IN (
      SELECT id FROM closed_tabs WHERE profile_id=? AND window_key=?
      ORDER BY closed_at DESC LIMIT -1 OFFSET 25
    )`).run(profileId, windowKey)
  })
  tx()
}

export function popClosedTab(profileId: string, windowKey: string): ClosedTab | null {
  const row = db.prepare(`SELECT id, entries_json, active_index, group_id
    FROM closed_tabs WHERE profile_id=? AND window_key=?
    ORDER BY closed_at DESC LIMIT 1`).get(profileId, windowKey) as any
  if (!row) return null
  db.prepare('DELETE FROM closed_tabs WHERE id=?').run(row.id)
  try {
    const entries = JSON.parse(row.entries_json)
    if (!Array.isArray(entries) || !entries.length) return null
    return { entries, activeIndex: row.active_index, groupId: row.group_id }
  } catch {
    return null
  }
}

function zoomOrigin(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null
  } catch { return null }
}

export function zoomFor(profileId: string, url: string): number {
  const origin = zoomOrigin(url)
  if (!origin) return 0
  const row = db.prepare('SELECT level FROM zoom_levels WHERE profile_id=? AND origin=?')
    .get(profileId, origin) as { level: number } | undefined
  return row?.level ?? 0
}

export function saveZoom(profileId: string, url: string, level: number): void {
  const origin = zoomOrigin(url)
  if (!origin) return
  if (level === 0) {
    db.prepare('DELETE FROM zoom_levels WHERE profile_id=? AND origin=?').run(profileId, origin)
    return
  }
  db.prepare(`INSERT INTO zoom_levels(profile_id,origin,level) VALUES(?,?,?)
    ON CONFLICT(profile_id,origin) DO UPDATE SET level=excluded.level`)
    .run(profileId, origin, level)
}

// ——— history ———————————————————————————————————————————————

export function addHistory(
  profileId: string, url: string, title: string, excerpt: string | null
): number {
  const info = db.prepare(
    'INSERT INTO history(profile_id,url,title,excerpt,visited_at) VALUES(?,?,?,?,?)'
  ).run(profileId, url, title, excerpt, new Date().toISOString())
  return Number(info.lastInsertRowid)
}

export function setDwell(id: number, ms: number): void {
  db.prepare('UPDATE history SET dwell_ms = dwell_ms + ? WHERE id = ?').run(ms, id)
}

const rowToHistory = (r: any): HistoryEntry => ({
  id: r.id, profileId: r.profile_id, url: r.url, title: r.title,
  excerpt: r.excerpt, visitedAt: r.visited_at, dwellMs: r.dwell_ms
})

/** Full-text search over titles and stored excerpts. */
export function searchHistory(profileId: string, query: string, limit = 40): HistoryEntry[] {
  const q = query.trim()
  if (!q) {
    return (db.prepare(
      'SELECT * FROM history WHERE profile_id=? ORDER BY visited_at DESC LIMIT ?'
    ).all(profileId, limit) as any[]).map(rowToHistory)
  }
  // Quote each term so punctuation in the query can't break FTS5 syntax.
  const match = q.split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ')
  try {
    return (db.prepare(`
      SELECT h.* FROM history_fts f JOIN history h ON h.id = f.rowid
      WHERE history_fts MATCH ? AND h.profile_id = ?
      ORDER BY bm25(history_fts), h.visited_at DESC LIMIT ?
    `).all(match, profileId, limit) as any[]).map(rowToHistory)
  } catch {
    return (db.prepare(
      'SELECT * FROM history WHERE profile_id=? AND (title LIKE ? OR url LIKE ?) ORDER BY visited_at DESC LIMIT ?'
    ).all(profileId, `%${q}%`, `%${q}%`, limit) as any[]).map(rowToHistory)
  }
}

export function historySince(profileId: string, sinceIso: string, limit = 200): HistoryEntry[] {
  return (db.prepare(
    'SELECT * FROM history WHERE profile_id=? AND visited_at >= ? ORDER BY visited_at DESC LIMIT ?'
  ).all(profileId, sinceIso, limit) as any[]).map(rowToHistory)
}

export function deleteHistory(id: number): void {
  db.prepare('DELETE FROM history WHERE id=?').run(id)
}

export function clearHistory(profileId: string, sinceIso?: string): void {
  if (sinceIso) db.prepare('DELETE FROM history WHERE profile_id=? AND visited_at>=?').run(profileId, sinceIso)
  else db.prepare('DELETE FROM history WHERE profile_id=?').run(profileId)
}

/** Drop history past the retention window. Called on launch and daily. */
export function pruneHistory(retentionDays: number): number {
  if (retentionDays <= 0) return 0
  const cutoff = new Date(Date.now() - retentionDays * 864e5).toISOString()
  return db.prepare('DELETE FROM history WHERE visited_at < ?').run(cutoff).changes
}

export function forgetDomain(profileId: string, domain: string): void {
  const escaped = domain.replace(/[\\%_]/g, '\\$&')
  db.prepare("DELETE FROM history WHERE profile_id=? AND url LIKE ? ESCAPE '\\'")
    .run(profileId, `%${escaped}%`)
  db.prepare("DELETE FROM memory WHERE profile_id=? AND source LIKE ? ESCAPE '\\'")
    .run(profileId, `%${escaped}%`)
}

// ——— memory ————————————————————————————————————————————————

const rowToMemory = (r: any): MemoryItem => ({
  id: r.id, profileId: r.profile_id, kind: r.kind, text: r.text, source: r.source,
  confidence: r.confidence, expiresAt: r.expires_at, pinned: !!r.pinned,
  createdAt: r.created_at, lastUsedAt: r.last_used_at, useCount: r.use_count
})

export function addMemory(
  profileId: string, kind: MemoryKind, text: string, source: string,
  confidence = 0.8, expiresAt: string | null = null
): MemoryItem {
  // Near-duplicate guard: same profile + identical normalised text is an update.
  const norm = text.trim()
  const dup = db.prepare(
    'SELECT * FROM memory WHERE profile_id=? AND lower(text)=lower(?)'
  ).get(profileId, norm) as any
  if (dup) {
    db.prepare('UPDATE memory SET confidence=?, source=?, expires_at=? WHERE id=?')
      .run(Math.max(dup.confidence, confidence), source, expiresAt, dup.id)
    return rowToMemory({ ...dup, confidence: Math.max(dup.confidence, confidence), source, expires_at: expiresAt })
  }
  const item: MemoryItem = {
    id: randomUUID(), profileId, kind, text: norm, source, confidence,
    expiresAt, pinned: false, createdAt: new Date().toISOString(),
    lastUsedAt: null, useCount: 0
  }
  db.prepare(`INSERT INTO memory
    (id,profile_id,kind,text,source,confidence,expires_at,pinned,created_at,last_used_at,use_count)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(item.id, item.profileId, item.kind, item.text, item.source, item.confidence,
         item.expiresAt, 0, item.createdAt, null, 0)
  return item
}

export function listMemory(profileId: string): MemoryItem[] {
  return (db.prepare(
    'SELECT * FROM memory WHERE profile_id=? ORDER BY pinned DESC, use_count DESC, created_at DESC'
  ).all(profileId) as any[]).map(rowToMemory)
}

/** What gets injected into a prompt: pinned first, then most-used, expired dropped. */
export function recallMemory(profileId: string, limit = 40): MemoryItem[] {
  const now = new Date().toISOString()
  return (db.prepare(`
    SELECT * FROM memory WHERE profile_id=? AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY pinned DESC, use_count DESC, created_at DESC LIMIT ?
  `).all(profileId, now, limit) as any[]).map(rowToMemory)
}

export function touchMemory(ids: string[]): void {
  if (!ids.length) return
  const now = new Date().toISOString()
  const stmt = db.prepare('UPDATE memory SET use_count = use_count + 1, last_used_at = ? WHERE id = ?')
  const tx = db.transaction((list: string[]) => { for (const id of list) stmt.run(now, id) })
  tx(ids)
}

export function deleteMemory(id: string): void {
  db.prepare('DELETE FROM memory WHERE id=?').run(id)
}

export function pinMemory(id: string, pinned: boolean): void {
  db.prepare('UPDATE memory SET pinned=? WHERE id=?').run(pinned ? 1 : 0, id)
}

export function clearMemory(profileId: string): void {
  db.prepare('DELETE FROM memory WHERE profile_id=?').run(profileId)
}

// ——— skills ————————————————————————————————————————————————

const rowToSkill = (r: any): Skill => ({
  id: r.id, slug: r.slug, name: r.name, description: r.description, prompt: r.prompt,
  context: JSON.parse(r.context_json), model: r.model, builtin: !!r.builtin,
  hotkey: r.hotkey, createdAt: r.created_at, updatedAt: r.updated_at
})

export function listSkills(): Skill[] {
  return (db.prepare('SELECT * FROM skills ORDER BY builtin DESC, name').all() as any[]).map(rowToSkill)
}

export function upsertSkill(s: Skill): void {
  db.prepare(`INSERT INTO skills
    (id,slug,name,description,prompt,context_json,model,builtin,hotkey,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, name=excluded.name,
      description=excluded.description, prompt=excluded.prompt,
      context_json=excluded.context_json, model=excluded.model,
      hotkey=excluded.hotkey, updated_at=excluded.updated_at`)
    .run(s.id, s.slug, s.name, s.description, s.prompt, JSON.stringify(s.context),
         s.model, s.builtin ? 1 : 0, s.hotkey, s.createdAt, s.updatedAt)
}

export function deleteSkill(id: string): void {
  db.prepare('DELETE FROM skills WHERE id=? AND builtin=0').run(id)
}

// ——— conversations —————————————————————————————————————————

export function createConversation(profileId: string, title = 'New chat'): Conversation {
  const now = new Date().toISOString()
  const c: Conversation = { id: randomUUID(), profileId, title, createdAt: now, updatedAt: now }
  db.prepare('INSERT INTO conversations(id,profile_id,title,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run(c.id, c.profileId, c.title, c.createdAt, c.updatedAt)
  return c
}

export function listConversations(profileId: string, limit = 50): Conversation[] {
  return (db.prepare(
    'SELECT * FROM conversations WHERE profile_id=? ORDER BY updated_at DESC LIMIT ?'
  ).all(profileId, limit) as any[]).map((r) => ({
    id: r.id, profileId: r.profile_id, title: r.title,
    createdAt: r.created_at, updatedAt: r.updated_at
  }))
}

export function renameConversation(id: string, title: string): void {
  db.prepare('UPDATE conversations SET title=?, updated_at=? WHERE id=?')
    .run(title, new Date().toISOString(), id)
}

export function deleteConversation(id: string): void {
  db.prepare('DELETE FROM conversations WHERE id=?').run(id)
}

export function saveMessage(m: ChatMessage): void {
  db.prepare(`INSERT INTO messages
    (id,conversation_id,role,text,thinking,steps_json,citations_json,attachments_json,error,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET text=excluded.text, thinking=excluded.thinking,
      steps_json=excluded.steps_json, citations_json=excluded.citations_json,
      error=excluded.error`)
    .run(m.id, m.conversationId, m.role, m.text, m.thinking, JSON.stringify(m.steps),
         JSON.stringify(m.citations), JSON.stringify(m.attachments), m.error, m.createdAt)
  db.prepare('UPDATE conversations SET updated_at=? WHERE id=?')
    .run(new Date().toISOString(), m.conversationId)
}

export function ownsConversation(profileId: string, conversationId: string): boolean {
  return !!db.prepare('SELECT 1 FROM conversations WHERE profile_id=? AND id=?').get(profileId, conversationId)
}

export function loadMessages(conversationId: string): ChatMessage[] {
  return (db.prepare(
    'SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at'
  ).all(conversationId) as any[]).map((r) => ({
    id: r.id, conversationId: r.conversation_id, role: r.role, text: r.text,
    thinking: r.thinking, steps: JSON.parse(r.steps_json),
    citations: JSON.parse(r.citations_json), attachments: JSON.parse(r.attachments_json),
    error: r.error, createdAt: r.created_at
  }))
}

// ——— bookmarks —————————————————————————————————————————————

const bookmarkWatchers = new Set<(profileId: string) => void>()
export function watchBookmarks(fn: (profileId: string) => void): () => void {
  bookmarkWatchers.add(fn)
  return () => { bookmarkWatchers.delete(fn) }
}
function bookmarksChanged(profileId: string): void {
  for (const fn of bookmarkWatchers) fn(profileId)
}
const bookmarkRow = (row: any): Bookmark => ({ ...row, shortcut: !!row.shortcut })

export function addBookmark(profileId: string, url: string, title: string, folder: string | null, shortcut = false): Bookmark {
  if (shortcut) url = shortcutUrl(url)
  const existing = db.prepare('SELECT * FROM bookmarks WHERE profile_id=? AND url=? LIMIT 1').get(profileId, url)
  if (existing) {
    const row = bookmarkRow(existing)
    return shortcut ? setBookmarkShortcut(profileId, row.id, true) : row
  }
  if (shortcut && listBookmarkShortcuts(profileId).length >= MAX_SHORTCUTS) throw new Error(`You can keep up to ${MAX_SHORTCUTS} favorites.`)
  const row: Bookmark = {
    id: randomUUID(), profile_id: profileId, url, title,
    folder, shortcut, created_at: new Date().toISOString()
  }
  db.prepare('INSERT INTO bookmarks(id,profile_id,url,title,folder,shortcut,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(row.id, row.profile_id, row.url, row.title, row.folder, row.shortcut ? 1 : 0, row.created_at)
  bookmarksChanged(profileId)
  return row
}

export function listBookmarks(profileId: string): Bookmark[] {
  return db.prepare('SELECT * FROM bookmarks WHERE profile_id=? ORDER BY created_at DESC')
    .all(profileId).map(bookmarkRow)
}

export function getBookmark(profileId: string, id: string): Bookmark | null {
  const row = db.prepare('SELECT * FROM bookmarks WHERE profile_id=? AND id=?').get(profileId, id)
  return row ? bookmarkRow(row) : null
}

export function listBookmarkShortcuts(profileId: string): Bookmark[] {
  return db.prepare('SELECT * FROM bookmarks WHERE profile_id=? AND shortcut=1 ORDER BY created_at, rowid')
    .all(profileId).map(bookmarkRow)
}

export function setBookmarkShortcut(profileId: string, id: string, shortcut: boolean): Bookmark {
  const row = getBookmark(profileId, id)
  if (!row) throw new Error('This bookmark is not in the current profile.')
  if (shortcut) {
    if (!/^https?:\/\//i.test(row.url)) throw new Error('Only website bookmarks can be favorites.')
    shortcutUrl(row.url)
    if (!row.shortcut && listBookmarkShortcuts(profileId).length >= MAX_SHORTCUTS) throw new Error(`You can keep up to ${MAX_SHORTCUTS} favorites.`)
  }
  db.prepare('UPDATE bookmarks SET shortcut=? WHERE id=? AND profile_id=?').run(shortcut ? 1 : 0, id, profileId)
  bookmarksChanged(profileId)
  return { ...row, shortcut }
}

export function ensureBookmarkShortcuts(profileId: string): void {
  const key = `bookmark-shortcuts-initialized:${profileId}`
  if (kvGet(key, false)) return
  // A removed starter stays removed, including after a browser restart.
  const seed = db.transaction(() => {
    for (const site of STARTER_SHORTCUTS) addBookmark(profileId, site.url, site.title, null, true)
    kvSet(key, true)
  })
  seed()
}

export function deleteBookmark(profileId: string, id: string): void {
  db.prepare('DELETE FROM bookmarks WHERE id=? AND profile_id=?').run(id, profileId)
  bookmarksChanged(profileId)
}

/** Preview and commit use the same deduplication rules; commits are atomic. */
export function importBrowserRecords(profileId: string, data: {
  bookmarks: ImportedBookmark[]; history: ImportedHistory[]; passwords: ImportedPassword[]; skipped: number
}, preview = false): ImportCounts {
  if (!listProfiles().some((p) => p.id === profileId)) throw new Error('The destination profile no longer exists.')
  if (data.passwords.length && !hasSecureStorage()) throw new Error('Unlock your operating system credential storage before importing passwords.')
  const counts: ImportCounts = { bookmarks: 0, history: 0, passwords: 0, duplicates: 0, skipped: data.skipped }
  const seenBookmarks = new Set<string>(), seenHistory = new Set<string>(), seenLogins = new Set<string>()
  const bookmarkExists = db.prepare('SELECT 1 FROM bookmarks WHERE profile_id=? AND url=? LIMIT 1')
  const historyExists = db.prepare('SELECT 1 FROM history WHERE profile_id=? AND url=? AND visited_at=? LIMIT 1')
  const loginExists = db.prepare('SELECT 1 FROM logins WHERE profile_id=? AND origin=? AND username=? LIMIT 1')
  const bookmarkInsert = db.prepare('INSERT INTO bookmarks(id,profile_id,url,title,folder,shortcut,created_at) VALUES(?,?,?,?,?,0,?)')
  const historyInsert = db.prepare('INSERT INTO history(profile_id,url,title,excerpt,visited_at) VALUES(?,?,?,NULL,?)')
  const loginInsert = db.prepare('INSERT INTO logins(id,profile_id,origin,username,password_enc,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
  db.transaction(() => {
    for (const b of data.bookmarks) {
      if (seenBookmarks.has(b.url) || bookmarkExists.get(profileId, b.url)) { counts.duplicates++; continue }
      seenBookmarks.add(b.url)
      if (!preview) bookmarkInsert.run(randomUUID(), profileId, b.url, b.title, b.folder, b.createdAt)
      counts.bookmarks++
    }
    for (const h of data.history) {
      const key = JSON.stringify([h.url, h.visitedAt])
      if (seenHistory.has(key) || historyExists.get(profileId, h.url, h.visitedAt)) { counts.duplicates++; continue }
      seenHistory.add(key)
      if (!preview) historyInsert.run(profileId, h.url, h.title, h.visitedAt)
      counts.history++
    }
    for (const p of data.passwords) {
      const key = JSON.stringify([p.origin, p.username])
      if (seenLogins.has(key) || loginExists.get(profileId, p.origin, p.username)) { counts.duplicates++; continue }
      seenLogins.add(key)
      if (!preview) {
        const now = new Date().toISOString()
        loginInsert.run(randomUUID(), profileId, p.origin, p.username,
          safeStorage.encryptString(p.password).toString('base64'), now, now)
      }
      counts.passwords++
    }
  })()
  if (!preview && counts.bookmarks) bookmarksChanged(profileId)
  return counts
}

export function searchBookmarks(profileId: string, query: string, limit = 20): Bookmark[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 12)
  const where = terms.map(() => "AND (title || ' ' || url || ' ' || coalesce(folder,'')) LIKE ? ESCAPE '\\'").join(' ')
  const patterns = terms.map((term) => `%${term.replace(/[\\%_]/g, '\\$&')}%`)
  return db.prepare(`SELECT * FROM bookmarks WHERE profile_id=? ${where} ORDER BY shortcut DESC,created_at DESC LIMIT ?`)
    .all(profileId, ...patterns, Math.max(1, Math.min(Math.trunc(limit) || 20, 100))).map(bookmarkRow)
}

// ——— mcp ———————————————————————————————————————————————————

const CONNECTOR_SECRET_PREFIX = 'voyager-secret-v1:'

function protectConnectorSecrets(c: McpServerConfig): McpServerConfig {
  const values = [...Object.values(c.env ?? {}), ...Object.values(c.headers ?? {})]
  if (values.some(Boolean) && !hasSecureStorage()) {
    throw new Error('Secure credential storage is unavailable. Voyager refused to save connector secrets.')
  }
  const protect = (source: Record<string, string> | undefined): Record<string, string> | undefined => {
    if (!source) return undefined
    return Object.fromEntries(Object.entries(source).map(([key, value]) => [
      key,
      value ? CONNECTOR_SECRET_PREFIX + safeStorage.encryptString(value).toString('base64') : ''
    ]))
  }
  return { ...c, env: protect(c.env), headers: protect(c.headers) }
}

function revealConnectorSecrets(c: McpServerConfig): { config: McpServerConfig; legacy: boolean } {
  let legacy = false
  const reveal = (source: Record<string, string> | undefined): Record<string, string> | undefined => {
    if (!source) return undefined
    return Object.fromEntries(Object.entries(source).map(([key, value]) => {
      if (!value.startsWith(CONNECTOR_SECRET_PREFIX)) {
        if (value) legacy = true
        return [key, value]
      }
      try {
        if (!hasSecureStorage()) throw new Error('Secure storage unavailable')
        return [key, safeStorage.decryptString(
          Buffer.from(value.slice(CONNECTOR_SECRET_PREFIX.length), 'base64')
        )]
      } catch {
        return [key, '']
      }
    }))
  }
  return { config: { ...c, env: reveal(c.env), headers: reveal(c.headers) }, legacy }
}

export function listMcpServers(): McpServerConfig[] {
  const configs: McpServerConfig[] = []
  for (const row of db.prepare('SELECT config_json FROM mcp_servers').all() as { config_json: string }[]) {
    try {
      const { config, legacy } = revealConnectorSecrets(
        JSON.parse(row.config_json) as McpServerConfig
      )
      if (legacy && !hasSecureStorage()) continue
      configs.push(config)
      // One-way migration from builds that stored connector tokens as JSON.
      if (legacy && hasSecureStorage()) {
        const protectedConfig = protectConnectorSecrets(config)
        db.prepare('UPDATE mcp_servers SET config_json=? WHERE id=?')
          .run(JSON.stringify(protectedConfig), config.id)
      }
    } catch { /* ignore a corrupt connector row; it cannot be run safely */ }
  }
  return configs
}

export function upsertMcpServer(c: McpServerConfig): void {
  const protectedConfig = protectConnectorSecrets(c)
  db.prepare('INSERT INTO mcp_servers(id,config_json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json')
    .run(c.id, JSON.stringify(protectedConfig))
}

export function deleteMcpServer(id: string): void {
  db.prepare('DELETE FROM mcp_servers WHERE id=?').run(id)
}

// ——— briefs ————————————————————————————————————————————————

export function saveBrief(b: Brief): void {
  db.prepare(`INSERT INTO briefs(id,profile_id,date,sections_json,generated_at)
    VALUES(?,?,?,?,?)
    ON CONFLICT(profile_id,date) DO UPDATE SET sections_json=excluded.sections_json,
      generated_at=excluded.generated_at`)
    .run(b.id, b.profileId, b.date, JSON.stringify(b.sections), b.generatedAt)
}

export function getBrief(profileId: string, date: string): Brief | null {
  const r = db.prepare('SELECT * FROM briefs WHERE profile_id=? AND date=?').get(profileId, date) as any
  if (!r) return null
  return {
    id: r.id, profileId: r.profile_id, date: r.date,
    sections: JSON.parse(r.sections_json), generatedAt: r.generated_at
  }
}

// ——— site permissions ——————————————————————————————————————

/**
 * Null means the user has never been asked for this pair, which is the only
 * state that produces a prompt. Anything else is a standing answer.
 */
export function permissionDecision(
  profileId: string, origin: string, permission: string
): boolean | null {
  const row = db.prepare(
    'SELECT allowed FROM site_permissions WHERE profile_id=? AND origin=? AND permission=?'
  ).get(profileId, origin, permission) as { allowed: number } | undefined
  return row ? row.allowed === 1 : null
}

export function recordPermission(
  profileId: string, origin: string, permission: string, allowed: boolean
): void {
  db.prepare(`INSERT INTO site_permissions(profile_id,origin,permission,allowed,decided_at)
    VALUES(?,?,?,?,?)
    ON CONFLICT(profile_id,origin,permission) DO UPDATE SET
      allowed=excluded.allowed, decided_at=excluded.decided_at`)
    .run(profileId, origin, permission, allowed ? 1 : 0, new Date().toISOString())
}

export function listPermissions(profileId: string): SitePermission[] {
  return (db.prepare(
    'SELECT * FROM site_permissions WHERE profile_id=? ORDER BY origin, permission'
  ).all(profileId) as any[]).map((r) => ({
    origin: r.origin, permission: r.permission,
    allowed: r.allowed === 1, decidedAt: r.decided_at
  }))
}

export function revokePermission(profileId: string, origin: string, permission: string): void {
  db.prepare('DELETE FROM site_permissions WHERE profile_id=? AND origin=? AND permission=?')
    .run(profileId, origin, permission)
}

export function clearPermissions(profileId: string): void {
  db.prepare('DELETE FROM site_permissions WHERE profile_id=?').run(profileId)
}

// ——— saved logins ——————————————————————————————————————————

const rowToLogin = (r: any): SavedLogin => ({
  id: r.id, origin: r.origin, username: r.username,
  createdAt: r.created_at, updatedAt: r.updated_at, usedAt: r.used_at
})

/** Never returns the password. Decryption is a separate, deliberate call. */
export function listLogins(profileId: string, origin?: string): SavedLogin[] {
  const rows = origin
    ? db.prepare('SELECT * FROM logins WHERE profile_id=? AND origin=? ORDER BY used_at DESC, username')
        .all(profileId, origin)
    : db.prepare('SELECT * FROM logins WHERE profile_id=? ORDER BY origin, username').all(profileId)
  return (rows as any[]).map(rowToLogin)
}

export function upsertLogin(
  profileId: string, origin: string, username: string, passwordEnc: string
): SavedLogin {
  const now = new Date().toISOString()
  const existing = db.prepare(
    'SELECT id, created_at FROM logins WHERE profile_id=? AND origin=? AND username=?'
  ).get(profileId, origin, username) as { id: string; created_at: string } | undefined
  const id = existing?.id ?? `lg_${randomUUID()}`
  db.prepare(`INSERT INTO logins(id,profile_id,origin,username,password_enc,created_at,updated_at,used_at)
    VALUES(?,?,?,?,?,?,?,NULL)
    ON CONFLICT(profile_id,origin,username) DO UPDATE SET
      password_enc=excluded.password_enc, updated_at=excluded.updated_at`)
    .run(id, profileId, origin, username, passwordEnc, existing?.created_at ?? now, now)
  return { id, origin, username, createdAt: existing?.created_at ?? now, updatedAt: now, usedAt: null }
}

export function loginSecret(profileId: string, id: string): string | null {
  const row = db.prepare('SELECT password_enc FROM logins WHERE profile_id=? AND id=?')
    .get(profileId, id) as { password_enc: string } | undefined
  return row?.password_enc ?? null
}

export function touchLogin(profileId: string, id: string): void {
  db.prepare('UPDATE logins SET used_at=? WHERE profile_id=? AND id=?')
    .run(new Date().toISOString(), profileId, id)
}

export function deleteLogin(profileId: string, id: string): void {
  db.prepare('DELETE FROM logins WHERE profile_id=? AND id=?').run(profileId, id)
}

export function closeDb(): void {
  if (db) db.close()
}

import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  MemoryItem, MemoryKind, Skill, HistoryEntry, Conversation, ChatMessage,
  Profile, TabGroup, McpServerConfig, Brief, Bookmark, SitePermission, SavedLogin
} from '@shared/types'

let db: Database.Database

export function openDb(): Database.Database {
  if (db) return db
  db = new Database(join(app.getPath('userData'), 'kia.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
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
    id, name, color, partition: `persist:kia-${id}`, persona,
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
  db.prepare('DELETE FROM profiles WHERE id=?').run(id)
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

export function forgetDomain(domain: string): void {
  db.prepare("DELETE FROM history WHERE url LIKE ?").run(`%${domain}%`)
  db.prepare("DELETE FROM memory WHERE source LIKE ?").run(`%${domain}%`)
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

export function addBookmark(profileId: string, url: string, title: string, folder: string | null): Bookmark {
  const row: Bookmark = {
    id: randomUUID(), profile_id: profileId, url, title,
    folder, created_at: new Date().toISOString()
  }
  db.prepare('INSERT INTO bookmarks(id,profile_id,url,title,folder,created_at) VALUES(?,?,?,?,?,?)')
    .run(row.id, row.profile_id, row.url, row.title, row.folder, row.created_at)
  return row
}

export function listBookmarks(profileId: string): Bookmark[] {
  return db.prepare('SELECT * FROM bookmarks WHERE profile_id=? ORDER BY created_at DESC')
    .all(profileId) as Bookmark[]
}

export function deleteBookmark(id: string): void {
  db.prepare('DELETE FROM bookmarks WHERE id=?').run(id)
}

// ——— mcp ———————————————————————————————————————————————————

export function listMcpServers(): McpServerConfig[] {
  return (db.prepare('SELECT config_json FROM mcp_servers').all() as any[])
    .map((r) => JSON.parse(r.config_json) as McpServerConfig)
}

export function upsertMcpServer(c: McpServerConfig): void {
  db.prepare('INSERT INTO mcp_servers(id,config_json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json')
    .run(c.id, JSON.stringify(c))
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

/** Pure parsers: never execute imported HTML, load URLs, or decrypt Chrome files. */
export interface ImportedBookmark { url: string; title: string; folder: string | null; createdAt: string }
export interface ImportedHistory { url: string; title: string; visitedAt: string }
export interface ImportedPassword { origin: string; username: string; password: string }
export interface Parsed<T> { rows: T[]; skipped: number }

export const MAX_IMPORT_ROWS = 50_000
const MAX_TEXT_BYTES = 32 * 1024 * 1024
export function checkImportText(text: string): void {
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw new Error('Import files must be smaller than 32 MB.')
}

export function importUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) return null
  try {
    const u = new URL(value)
    return /^https?:$/.test(u.protocol) && u.hostname && !u.username && !u.password ? u.href : null
  } catch { return null }
}

/** Chrome stores microseconds since 1601; BigInt avoids losing timestamp precision. */
export function chromeTime(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'bigint' && typeof value !== 'number') return null
  if (!/^\d{1,20}$/.test(String(value))) return null
  const ms = Number(BigInt(value) / 1000n - 11644473600000n)
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > Date.now() + 86400_000) return null
  return new Date(ms).toISOString()
}

const label = (v: unknown, fallback = ''): string => typeof v === 'string' ? v.slice(0, 2000) : fallback
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function parseChromeBookmarks(text: string): Parsed<ImportedBookmark> {
  checkImportText(text)
  let data: unknown
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')) } catch { throw new Error('This is not a valid Chrome bookmarks file.') }
  if (!object(data) || !object(data.roots)) throw new Error('This file does not contain Chrome bookmark folders.')
  const result: Parsed<ImportedBookmark> = { rows: [], skipped: 0 }
  let visited = 0
  const walk = (node: unknown, folders: string[], depth: number): void => {
    if (++visited > 100_000 || depth > 100) throw new Error('This bookmark file is too large or deeply nested.')
    if (!object(node)) { result.skipped++; return }
    if (node.type === 'url') {
      const url = importUrl(node.url)
      if (!url) { result.skipped++; return }
      if (result.rows.length >= MAX_IMPORT_ROWS) throw new Error('Import at most 50,000 bookmarks at a time.')
      result.rows.push({ url, title: label(node.name, url), folder: folders.join(' / ').slice(0, 4000) || null,
        createdAt: chromeTime(node.date_added) ?? new Date().toISOString() })
    } else if (Array.isArray(node.children)) {
      const path = node.name ? [...folders, label(node.name)] : folders
      for (const child of node.children) walk(child, path, depth + 1)
    } else result.skipped++
  }
  for (const root of Object.values(data.roots)) walk(root, [], 0)
  return result
}

function decodeHtml(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? whole
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ''
  })
}

/** Parses Chrome's Netscape bookmark export as text; it never becomes a DOM. */
export function parseBookmarksHtml(text: string): Parsed<ImportedBookmark> {
  checkImportText(text)
  if (!/<!DOCTYPE NETSCAPE-Bookmark-file-1>/i.test(text)) throw new Error('Choose an HTML file exported from Chrome’s bookmark manager.')
  const result: Parsed<ImportedBookmark> = { rows: [], skipped: 0 }
  const folders: string[] = []
  let pending = ''
  const tokens = text.matchAll(/<H3\b[^>]*>([\s\S]*?)<\/H3\s*>|<DL\b[^>]*>|<\/DL\s*>|<A\b([^>]*)>([\s\S]*?)<\/A\s*>/gi)
  const plain = (s: string): string => decodeHtml(s.replace(/<[^>]*>/g, '')).slice(0, 2000)
  for (const m of tokens) {
    if (/^<H3/i.test(m[0])) pending = plain(m[1])
    else if (/^<DL/i.test(m[0])) { folders.push(pending); pending = ''; if (folders.length > 100) throw new Error('Bookmark folders are too deeply nested.') }
    else if (/^<\/DL/i.test(m[0])) folders.pop()
    else {
      const attrs = m[2]
      const href = /\bHREF\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)
      const url = importUrl(decodeHtml(href?.[1] ?? href?.[2] ?? ''))
      if (!url) { result.skipped++; continue }
      if (result.rows.length >= MAX_IMPORT_ROWS) throw new Error('Import at most 50,000 bookmarks at a time.')
      const seconds = Number(/\bADD_DATE\s*=\s*"(\d+)"/i.exec(attrs)?.[1])
      const date = seconds > 0 && seconds * 1000 <= Date.now() ? new Date(seconds * 1000).toISOString() : new Date().toISOString()
      result.rows.push({ url, title: plain(m[3]) || url, folder: folders.filter(Boolean).join(' / ').slice(0, 4000) || null, createdAt: date })
    }
  }
  return result
}

/** RFC 4180 quoting, including embedded commas, quotes, CRLF and newlines. */
export function parsePasswordsCsv(text: string): Parsed<ImportedPassword> {
  checkImportText(text)
  const records: string[][] = []
  let row: string[] = [], field = '', quoted = false, closed = false
  const finishField = (): void => { row.push(field); field = ''; closed = false; if (row.length > 30) throw new Error('Too many CSV columns.') }
  const finishRow = (): void => {
    finishField()
    if (row.some(Boolean)) records.push(row)
    row = []
    if (records.length > MAX_IMPORT_ROWS + 1) throw new Error('Import at most 50,000 passwords at a time.')
  }
  const source = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') { field += '"'; i++ }
        else { quoted = false; closed = true }
      } else field += c
    } else if (c === ',') finishField()
    else if (c === '\r' || c === '\n') { if (c === '\r' && source[i + 1] === '\n') i++; finishRow() }
    else if (c === '"' && !field && !closed) quoted = true
    else { if (closed || c === '"') throw new Error('Malformed CSV quoting. Export the passwords again from Chrome.'); field += c }
    if (field.length > 100_000) throw new Error('A CSV field is too large.')
  }
  if (quoted) throw new Error('Incomplete CSV file. Export the passwords again from Chrome.')
  if (field || row.length || closed) finishRow()
  const header = records.shift()?.map((h) => h.trim().toLowerCase()) ?? []
  const columns = ['url', 'username', 'password'].map((h) => header.indexOf(h))
  if (columns.some((n) => n < 0) || new Set(header).size !== header.length) throw new Error('Choose a Chrome password CSV with url, username, and password columns.')
  const result: Parsed<ImportedPassword> = { rows: [], skipped: 0 }
  for (const r of records) {
    const url = importUrl(r[columns[0]])
    const username = r[columns[1]], password = r[columns[2]]
    const secure = url && (url.startsWith('https:') || ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname))
    if (r.length !== header.length || !secure || !username || !password || username.length > 2000 || password.length > 10_000) {
      result.skipped++; continue
    }
    result.rows.push({ origin: new URL(url!).origin, username, password })
  }
  return result
}

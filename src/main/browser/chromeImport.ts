import { app, dialog } from 'electron'
import Database from 'better-sqlite3'
import { open, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChromeProfile, ChromeImportSelection, ImportFileKind, ImportPreview, ImportCounts } from '@shared/browserImport'
import type { VoyagerWindow } from './window'
import { getSettings, isExcluded } from '../store/settings'
import { importBrowserRecords } from '../store/db'
import { chromeTime, importUrl, MAX_IMPORT_ROWS, parseChromeBookmarks, parseBookmarksHtml, parsePasswordsCsv,
  type ImportedBookmark, type ImportedHistory, type ImportedPassword } from './importParsers'

interface ImportData {
  bookmarks: ImportedBookmark[]; history: ImportedHistory[]; passwords: ImportedPassword[]; skipped: number
}
interface Pending { id: string; profileId: string; data: ImportData; timer: ReturnType<typeof setTimeout> }
const pending = new WeakMap<VoyagerWindow, Pending>()
const profiles = new WeakMap<VoyagerWindow, Map<string, string>>()
const busy = new WeakSet<VoyagerWindow>()
const generations = new WeakMap<VoyagerWindow, number>()
const MAX_FILE = 32 * 1024 * 1024

/** Bounded reads keep a replaced or growing file from allocating unbounded memory. */
async function readText(path: string): Promise<string> {
  const file = await open(path, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > MAX_FILE) throw new Error('Choose a regular file smaller than 32 MB.')
    const chunks: Buffer[] = []
    let total = 0
    while (total <= MAX_FILE) {
      const buffer = Buffer.alloc(Math.min(65536, MAX_FILE + 1 - total))
      const { bytesRead } = await file.read(buffer)
      if (!bytesRead) return Buffer.concat(chunks).toString('utf8')
      chunks.push(buffer.subarray(0, bytesRead)); total += bytesRead
    }
    throw new Error('Choose a file smaller than 32 MB.')
  } finally { await file.close() }
}

export function chromeRoots(platform: string, home: string, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'win32') return [join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'User Data')]
  if (platform === 'darwin') return [join(home, 'Library', 'Application Support', 'Google', 'Chrome')]
  const config = env.CHROME_CONFIG_HOME || env.XDG_CONFIG_HOME || join(home, '.config')
  return [join(config, 'google-chrome')]
}

const hasFile = async (path: string): Promise<boolean> => { try { return (await stat(path)).isFile() } catch { return false } }

async function discover(root: string, direct = false): Promise<{ public: ChromeProfile; path: string }[]> {
  let names: string[]
  if (direct && (await hasFile(join(root, 'Bookmarks')) || await hasFile(join(root, 'History')))) names = ['']
  else {
    try { names = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory() && /^(Default|Profile \d+)$/.test(d.name)).map((d) => d.name).sort() }
    catch { return [] }
  }
  let metadata: Record<string, { name?: string }> = {}
  try { metadata = JSON.parse(await readText(join(root, 'Local State')))?.profile?.info_cache ?? {} } catch { /* names are optional */ }
  const result: { public: ChromeProfile; path: string }[] = []
  for (const name of names.slice(0, 100)) {
    const path = join(root, name)
    const [bookmarks, history] = await Promise.all([hasFile(join(path, 'Bookmarks')), hasFile(join(path, 'History'))])
    if (!bookmarks && !history) continue
    const display = metadata?.[name]?.name
    result.push({ path, public: { id: randomUUID(), name: typeof display === 'string' ? display.slice(0, 200) : name || basename(root),
      directory: name || basename(root), bookmarks, history } })
  }
  return result
}

function ensureDestination(win: VoyagerWindow, profileId: string): void {
  if (win.window.isDestroyed() || win.profile.id !== profileId) throw new Error('The Voyager profile changed. Start the import again.')
}

async function exclusive<T>(win: VoyagerWindow, work: () => Promise<T>): Promise<T> {
  if (busy.has(win)) throw new Error('Another import operation is still running.')
  const generation = generations.get(win) ?? 0
  const manager = win.tabs
  busy.add(win)
  try {
    const result = await work()
    if ((generations.get(win) ?? 0) !== generation || manager !== win.tabs || win.window.isDestroyed()) {
      discardPending(win)
      throw new Error('The import was cancelled. Start it again in the current profile.')
    }
    return result
  } finally { busy.delete(win) }
}

export async function listChromeProfiles(win: VoyagerWindow, chooseFolder = false): Promise<ChromeProfile[] | null> {
  return exclusive(win, async () => {
    const profileId = win.profile.id
    let roots = chromeRoots(process.platform, app.getPath('home'), process.env)
    if (chooseFolder) {
      const chosen = await dialog.showOpenDialog(win.window, { title: 'Choose a Chrome profile or User Data folder', properties: ['openDirectory'] })
      if (chosen.canceled || !chosen.filePaths[0]) return null
      roots = [chosen.filePaths[0]]
    }
    const found = (await Promise.all(roots.map((r) => discover(r, chooseFolder)))).flat()
    ensureDestination(win, profileId)
    discardPending(win)
    profiles.set(win, new Map(found.map((p) => [p.public.id, p.path])))
    return found.map((p) => p.public)
  })
}

/** Read Chrome's existing database, including its WAL, without copying or updating it. */
export function readChromeHistory(path: string): { rows: ImportedHistory[]; skipped: number; capped: boolean } {
  let source: Database.Database | undefined
  try {
    source = new Database(path, { readonly: true, fileMustExist: true, timeout: 1500 })
    source.pragma('query_only = ON'); source.pragma('trusted_schema = OFF')
    const raw = source.prepare('SELECT url, title, CAST(last_visit_time AS TEXT) AS last_visit_time FROM urls WHERE hidden=0 AND last_visit_time>0 ORDER BY last_visit_time DESC LIMIT ?')
      .all(MAX_IMPORT_ROWS + 1) as { url: unknown; title: unknown; last_visit_time: unknown }[]
    const rows: ImportedHistory[] = []
    let skipped = 0
    for (const r of raw.slice(0, MAX_IMPORT_ROWS)) {
      const url = importUrl(r.url), visitedAt = chromeTime(r.last_visit_time)
      if (!url || !visitedAt) { skipped++; continue }
      rows.push({ url, title: typeof r.title === 'string' ? r.title.slice(0, 2000) : url, visitedAt })
    }
    return { rows, skipped, capped: raw.length > MAX_IMPORT_ROWS }
  } catch {
    throw new Error('Chrome history could not be read. Quit Chrome completely and try again. If needed, choose the profile folder shown at chrome://version in Chrome.')
  } finally { source?.close() }
}

export function applyImportPrivacy(data: ImportData): ImportData {
  const privacy = getSettings().privacy
  if (data.history.length && privacy.paused) throw new Error('History recording is paused. Resume it in Settings → Privacy, or import bookmarks only.')
  const cutoff = Date.now() - privacy.historyRetentionDays * 86400_000
  const history = data.history.filter((h) => !isExcluded(h.url) && Date.parse(h.visitedAt) >= cutoff)
  return { ...data, history, skipped: data.skipped + data.history.length - history.length }
}

function preview(win: VoyagerWindow, profileId: string, source: string, data: ImportData, warnings: string[]): ImportPreview {
  ensureDestination(win, profileId)
  discardPending(win)
  const filtered = applyImportPrivacy(data)
  const counts = importBrowserRecords(profileId, filtered, true)
  const id = randomUUID()
  const timer = setTimeout(() => cancelChromeImport(win), 10 * 60_000)
  timer.unref()
  pending.set(win, { id, profileId, data: filtered, timer })
  return { id, source, counts, warnings }
}

export async function previewChromeProfile(win: VoyagerWindow, selection: ChromeImportSelection): Promise<ImportPreview> {
  return exclusive(win, async () => {
    const profileId = win.profile.id
    if (!selection || typeof selection.bookmarks !== 'boolean' || typeof selection.history !== 'boolean'
      || (!selection.bookmarks && !selection.history)) throw new Error('Choose bookmarks or history to import.')
    const path = profiles.get(win)?.get(selection.profileId)
    if (!path) throw new Error('Choose a detected Chrome profile first.')
    const data: ImportData = { bookmarks: [], history: [], passwords: [], skipped: 0 }
    const warnings: string[] = []
    if (selection.bookmarks) {
      let text: string
      try { text = await readText(join(path, 'Bookmarks')) } catch { throw new Error('Chrome bookmarks could not be read. Quit Chrome and try again, or import a bookmark HTML export.') }
      const parsed = parseChromeBookmarks(text)
      data.bookmarks = parsed.rows; data.skipped += parsed.skipped
    }
    if (selection.history) {
      const parsed = readChromeHistory(join(path, 'History'))
      data.history = parsed.rows; data.skipped += parsed.skipped
      warnings.push('History includes the latest visit to each page, within your history retention period. Excluded sites are skipped; page contents are not imported.')
      if (parsed.capped) warnings.push('Only the 50,000 most recently visited pages were read from this profile.')
    }
    return preview(win, profileId, `Chrome · ${basename(path)}`, data, warnings)
  })
}

export async function previewImportFile(win: VoyagerWindow, kind: ImportFileKind): Promise<ImportPreview | null> {
  return exclusive(win, async () => {
    if (kind !== 'bookmarks' && kind !== 'passwords') throw new Error('Unsupported import type.')
    const profileId = win.profile.id
    const selected = await dialog.showOpenDialog(win.window, {
      title: kind === 'passwords' ? 'Choose a Chrome password CSV export' : 'Choose a Chrome bookmark export', properties: ['openFile'],
      filters: [{ name: kind === 'passwords' ? 'Password CSV' : 'Bookmarks', extensions: kind === 'passwords' ? ['csv'] : ['html', 'htm', 'json'] }]
    })
    if (selected.canceled || !selected.filePaths[0]) return null
    ensureDestination(win, profileId)
    const text = await readText(selected.filePaths[0])
    const data: ImportData = { bookmarks: [], history: [], passwords: [], skipped: 0 }
    if (kind === 'passwords') {
      const parsed = parsePasswordsCsv(text); data.passwords = parsed.rows; data.skipped = parsed.skipped
    } else {
      const parsed = text.replace(/^\uFEFF/, '').trimStart().startsWith('{') ? parseChromeBookmarks(text) : parseBookmarksHtml(text)
      data.bookmarks = parsed.rows; data.skipped = parsed.skipped
    }
    return preview(win, profileId, basename(selected.filePaths[0]), data, kind === 'passwords'
      ? ['The CSV contains readable passwords. Delete your exported file when you are finished. Existing logins are kept. Invalid records and insecure remote HTTP logins are skipped. Passwords are never shared with the assistant.'] : [])
  })
}

export function commitChromeImport(win: VoyagerWindow, id: string): ImportCounts {
  if (busy.has(win)) throw new Error('Wait for the current import operation to finish.')
  const job = pending.get(win)
  if (!job || job.id !== id) throw new Error('This preview expired. Review the import again.')
  try {
    ensureDestination(win, job.profileId)
    return importBrowserRecords(job.profileId, applyImportPrivacy(job.data))
  } finally { cancelChromeImport(win) }
}

export function cancelChromeImport(win: VoyagerWindow): void {
  generations.set(win, (generations.get(win) ?? 0) + 1)
  discardPending(win)
}

function discardPending(win: VoyagerWindow): void {
  const job = pending.get(win)
  if (job) { clearTimeout(job.timer); job.data.passwords.length = 0; pending.delete(win) }
}

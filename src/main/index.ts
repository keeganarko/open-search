import { app, BrowserWindow, dialog, nativeTheme, session } from 'electron'
import { join, dirname } from 'node:path'
import { writeFileSync, existsSync, renameSync, readdirSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { KiaWindow, post } from './browser/window'
import { showPageContextMenu, buildAppMenu, setAboutPanel, setNewWindowHandler } from './menu'
import { registerIpc } from './ipc'
import {
  openDb, closeDb, ensureDefaultProfile, pruneHistory, listProfiles,
  listSavedWindowKeys, dropSavedWindow
} from './store/db'
import { seedBuiltinSkills } from './store/builtinSkills'
import { getSettings } from './store/settings'
import { clearBrowsingData } from './browser/session'
import { setWindowResolver, cancelFor } from './browser/permissions'
import { loadInto } from './browser/extensions'
import { mcp } from './agent/mcp'
import { generateBrief, existingBrief } from './agent/brief'

const windows = new Set<KiaWindow>()
let focused: KiaWindow | null = null
let quitting = false

const DEV_URL = process.env.ELECTRON_RENDERER_URL ?? null
const INDEX_HTML = join(__dirname, '../renderer/index.html')
const OVERLAY_HTML = join(__dirname, '../renderer/overlay.html')

app.setName('Open Search')

/**
 * Chromium's single-instance lock is three symlinks naming a host, a pid and a
 * socket under /var/folders. Carried into the new directory they describe a
 * process that is long gone, and the app quits on launch without a word —
 * `requestSingleInstanceLock()` simply returns false. They are not user data.
 */
function dropSingleton(dir: string): void {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    rmSync(join(dir, name), { force: true })
  }
}

/**
 * `app.setName` moves `userData`, which would orphan the database, the cookies
 * and every logged-in session from an install made under the old name.
 *
 * Two traps here. This runs at module load because by `whenReady` Chromium has
 * already written into the new directory. And the path is built from `appData`
 * rather than read from `getPath('userData')`, because *asking* for userData is
 * what creates it — the check would pass through a directory it made itself.
 */
function migrateUserData(): void {
  const base = app.getPath('appData')
  const target = join(base, 'Open Search')
  const legacy = join(base, 'Kia')
  if (!existsSync(join(legacy, 'kia.db'))) return
  if (existsSync(join(target, 'kia.db'))) return
  try {
    if (!existsSync(target)) {
      renameSync(legacy, target)
      dropSingleton(target)
      return
    }
    // The directory exists but holds nothing of ours, so the old copy wins.
    for (const name of readdirSync(legacy)) {
      const dest = join(target, name)
      rmSync(dest, { recursive: true, force: true })
      renameSync(join(legacy, name), dest)
    }
    rmSync(legacy, { recursive: true, force: true })
    dropSingleton(target)
  } catch (err) {
    // A failed move is not fatal — the app starts with an empty profile rather
    // than not starting at all.
    console.error('[kia] userData migration failed:', err)
  }
}
migrateUserData()

// Chromium's own tab-freezing fights our WebContentsView show/hide cycle.
app.commandLine.appendSwitch('disable-features', 'IntensiveWakeUpThrottling')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const w = focused ?? [...windows][0]
    if (w) { if (w.window.isMinimized()) w.window.restore(); w.window.focus() }
  })
}

/**
 * Writes the morning brief once, on the first tick at or after the configured
 * time. `existingBrief` is keyed on the local date, so a machine that was asleep
 * at 07:00 still gets its brief when it wakes.
 */
let briefRunning = false
async function maybeGenerateBrief(): Promise<void> {
  if (briefRunning) return
  const settings = getSettings()
  if (!settings.brief.enabled || !settings.ai.apiKey) return
  const win = focused ?? [...windows][0]
  if (!win) return
  if (existingBrief(win.profile.id)) return

  const [h, m] = (settings.brief.at || '07:00').split(':').map(Number)
  const now = new Date()
  const due = new Date(now)
  due.setHours(h || 0, m || 0, 0, 0)
  if (now < due) return

  briefRunning = true
  try {
    const brief = await generateBrief(win)
    if (!win.chrome.webContents.isDestroyed()) {
      post(win.chrome.webContents, 'kia:brief-ready', brief)
    }
  } catch (err) {
    console.error('brief', err)
  } finally {
    briefRunning = false
  }
}

/**
 * Which window a webContents belongs to — its chrome, its overlay, or one of its
 * tabs. A menu click has no sender, so -1 falls through to the focused window.
 */
function windowForSender(senderId: number): KiaWindow | null {
  if (senderId >= 0) {
    for (const w of windows) {
      if (w.chrome.webContents.id === senderId) return w
      if (w.overlay.webContents.id === senderId) return w
      if (w.tabs.byWebContentsId(senderId)) return w
    }
  }
  return focused
}

async function createWindow(key = `w-${randomUUID()}`): Promise<KiaWindow> {
  const profiles = listProfiles()
  const profile = focused?.profile ?? profiles[0] ?? ensureDefaultProfile()
  const win = new KiaWindow(profile, key)
  windows.add(win)
  focused = win

  win.tabs.on('context-menu', (tab, params) => showPageContextMenu(win, tab.id, params))
  win.on('closing', () => {
    // `before-quit` has already persisted every window and closed the database
    // by the time these fire during a quit. Touching the store here would throw
    // "The database connection is not open" on the way out, every time.
    if (cleanedUp) return
    // Quitting keeps this window's tabs for next launch; closing it by hand does
    // not. Off macOS, closing the last window is how you quit.
    if (quitting || (process.platform !== 'darwin' && windows.size <= 1)) win.tabs.persist()
    else dropSavedWindow(win.profile.id, win.key)
  })
  win.on('closed', () => {
    // A permission sheet whose window went away must not leave the page waiting
    // on a promise nobody will ever settle.
    cancelFor(win)
    windows.delete(win)
    if (focused === win) focused = [...windows][0] ?? null
  })
  win.window.on('focus', () => { focused = win })

  await win.load(DEV_URL, INDEX_HTML, OVERLAY_HTML)
  return win
}

app.whenReady().then(async () => {
  openDb()
  ensureDefaultProfile()
  seedBuiltinSkills()

  const settings = getSettings()
  nativeTheme.themeSource = settings.appearance.theme
  pruneHistory(settings.privacy.historyRetentionDays)

  setAboutPanel()
  setNewWindowHandler(() => void createWindow())
  registerIpc(windowForSender)
  // The permission prompt has to know which window to put a sheet on, and it is
  // handed a WebContents rather than a sender id.
  setWindowResolver((wc) => windowForSender(wc.id))
  buildAppMenu(() => focused)

  // Extensions load per session partition, so every profile gets its own copy.
  for (const p of listProfiles()) await loadInto(p.partition).catch(() => { /* logged inside */ })

  // Connectors come up in the background; a slow server must not delay launch.
  void mcp.init()

  // One window per window that was open at the last quit; a fresh one if none.
  const restore = listSavedWindowKeys((focused?.profile ?? listProfiles()[0]).id)
  if (restore.length) for (const key of restore) await createWindow(key)
  else await createWindow()

  app.on('activate', () => {
    if (!windows.size && !BrowserWindow.getAllWindows().length) void createWindow()
  })

  // Daily prune while the app stays open for days at a time.
  setInterval(() => pruneHistory(getSettings().privacy.historyRetentionDays), 6 * 3600_000)
  setInterval(() => void maybeGenerateBrief(), 5 * 60_000)
  void maybeGenerateBrief()
}).catch((err) => {
  // A throw in here used to leave a running app with no window and no message.
  const detail = String((err as Error)?.stack ?? err)
  console.error('[kia] startup failed:', detail)
  try {
    writeFileSync(join(app.getPath('userData'), 'startup-error.log'),
      `${new Date().toISOString()}\n${detail}\n`)
  } catch { /* nothing useful left to do */ }
  if (!process.env.KIA_NO_DIALOG) {
    dialog.showErrorBox('Open Search could not start', detail)
  }
  app.exit(1)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let cleanedUp = false
app.on('before-quit', async (event) => {
  quitting = true
  if (cleanedUp) return
  event.preventDefault()
  cleanedUp = true
  for (const w of windows) w.tabs.persist()
  const settings = getSettings()
  if (settings.privacy.clearOnQuit) {
    for (const p of listProfiles()) {
      await clearBrowsingData(p.partition).catch(() => { /* best effort */ })
    }
  }
  await mcp.shutdown().catch(() => { /* best effort */ })
  closeDb()
  app.quit()
})

// A renderer crash must not take the browser down silently.
app.on('render-process-gone', (_e, _wc, details) => {
  console.error('[kia] render process gone:', details.reason)
})

/**
 * The ad blocker fires each cosmetic scriptlet with `executeJavaScript` inside a
 * try/catch that only sees synchronous throws, so a scriptlet that fails on a
 * hostile page rejects with nobody listening. Log it and carry on — a broken
 * filter on one page is not a reason to make noise on every page load.
 */
process.on('unhandledRejection', (reason) => {
  console.error('[kia] unhandled rejection:', reason)
})

process.on('uncaughtException', (err) => {
  console.error('[kia] uncaught:', err)
})

export { createWindow, windows }

import { app, BrowserWindow, dialog, nativeTheme, net, protocol } from 'electron'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { VoyagerWindow, post } from './browser/window'
import {
  showPageContextMenu, showUiContextMenu, buildAppMenu, setAboutPanel, setNewWindowHandler
} from './menu'
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
import { engine } from './agent/engine'
import { pageAgents } from './agent/agentRuntime'
import { initializeUpdates } from './security/updates'
import { initializeThreats } from './security/threats'
import { configureSpellcheck } from './security/spellcheck'

const windows = new Set<VoyagerWindow>()
let focused: VoyagerWindow | null = null
let quitting = false

const UI_ROOT = resolve(__dirname, '../renderer')

/**
 * A development-server URL is effectively code execution in the privileged UI.
 * Never honour it in a packaged build, and never accept a non-loopback host.
 */
function developmentRendererUrl(raw: string | undefined): string | null {
  if (app.isPackaged || !raw) return null
  try {
    const url = new URL(raw)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    return loopback && ['http:', 'https:'].includes(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

const DEV_URL = developmentRendererUrl(process.env.ELECTRON_RENDERER_URL)

app.on('session-created', (ses) => configureSpellcheck(ses))

// This branch is compiled out of release builds. A test build can only create
// its own disposable profile; it never accepts a profile path from arguments.
if (__SECURITY_TEST__) {
  const isolated = mkdtempSync(join(tmpdir(), 'voyager-runtime-security-'))
  app.setPath('userData', isolated)
  app.setPath('sessionData', isolated)
  app.setPath('downloads', isolated)
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * 127.0.0.1')
  app.commandLine.appendSwitch('disable-background-networking')
}

app.setName('Voyager')
if (process.platform === 'win32') app.setAppUserModelId('com.keeganarko.voyager')

// Custom schemes must be registered before app readiness. Each profile session
// installs the handler itself in `sessionFor`.
protocol.registerSchemesAsPrivileged([
  { scheme: 'voyager', privileges: { standard: true, secure: true, corsEnabled: true } },
  { scheme: 'voyager-app', privileges: { standard: true, secure: true, corsEnabled: true } }
])

// Sandboxing is the default policy for every renderer, including the privileged
// Voyager UI. Individual webPreferences still document that boundary.
app.enableSandbox()
app.commandLine.appendSwitch('site-per-process')

function registerUiProtocol(): void {
  protocol.handle('voyager-app', (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'ui') return new Response('Not found', { status: 404 })

    let relative: string
    try { relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') }
    catch { return new Response('Bad request', { status: 400 }) }

    const allowed = /^(?:index|overlay)\.html$/.test(relative)
      || /^assets\/[A-Za-z0-9_.-]+\.(?:js|css)$/.test(relative)
    const file = resolve(UI_ROOT, relative)
    if (!allowed || (file !== UI_ROOT && !file.startsWith(`${UI_ROOT}${sep}`))) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(file).toString())
  })
}

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
  if (!settings.brief.enabled || !settings.ai.apiKey || !settings.ai.contextConsent || settings.privacy.paused) return
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
      post(win.chrome.webContents, 'voyager:brief-ready', brief)
    }
  } catch (err) {
    console.error('brief', err)
  } finally {
    briefRunning = false
  }
}

/** Which window a WebContents belongs to. Unknown senders never inherit focus. */
function windowForSender(senderId: number): VoyagerWindow | null {
  for (const w of windows) {
    if (w.chrome.webContents.id === senderId) return w
    if (w.overlay.webContents.id === senderId) return w
    if (w.tabs.byWebContentsId(senderId)) return w
  }
  return null
}

function uiWindowForSender(senderId: number): VoyagerWindow | null {
  for (const w of windows) {
    if (w.chrome.webContents.id === senderId || w.overlay.webContents.id === senderId) return w
  }
  return null
}

function pageWindowForSender(senderId: number): VoyagerWindow | null {
  for (const w of windows) if (w.tabs.byWebContentsId(senderId)) return w
  return null
}

async function createWindow(key = `w-${randomUUID()}`): Promise<VoyagerWindow> {
  const profiles = listProfiles()
  const profile = focused?.profile ?? profiles[0] ?? ensureDefaultProfile()
  const win = new VoyagerWindow(profile, key)
  windows.add(win)
  focused = win

  win.tabs.on('context-menu', (tab, params) => showPageContextMenu(win, tab.id, params))
  win.chrome.webContents.on('context-menu', (_event, params) =>
    showUiContextMenu(win, win.chrome.webContents, params))
  win.overlay.webContents.on('context-menu', (_event, params) =>
    showUiContextMenu(win, win.overlay.webContents, params))
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
    engine.cancelFor(win)
    windows.delete(win)
    if (focused === win) focused = [...windows][0] ?? null
  })
  win.window.on('focus', () => { focused = win })

  await win.load(DEV_URL)
  return win
}

app.whenReady().then(async () => {
  registerUiProtocol()
  if (__SECURITY_TEST__) {
    registerIpc(uiWindowForSender, pageWindowForSender, () => windows, () => focused)
    setWindowResolver((wc) => windowForSender(wc.id))
    const { runRuntimeSecurityTests } = await import('./security/runtimeSelfTest')
    const success = await runRuntimeSecurityTests(createWindow)
    app.exit(success ? 0 : 1)
    return
  }
  openDb()
  ensureDefaultProfile()
  seedBuiltinSkills()
  await initializeThreats()
  await initializeUpdates()

  const settings = getSettings()
  nativeTheme.themeSource = settings.appearance.theme
  pruneHistory(settings.privacy.historyRetentionDays)

  setAboutPanel()
  setNewWindowHandler(() => void createWindow())
  registerIpc(uiWindowForSender, pageWindowForSender, () => windows, () => focused)
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
  console.error('[voyager] startup failed:', detail)
  try {
    writeFileSync(join(app.getPath('userData'), 'startup-error.log'),
      `${new Date().toISOString()}\n${detail}\n`)
  } catch { /* nothing useful left to do */ }
  if (!process.env.VOYAGER_NO_DIALOG) {
    dialog.showErrorBox('Voyager could not start', detail)
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
  pageAgents.shutdown()
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
  console.error('[voyager] render process gone:', details.reason)
})

/**
 * The ad blocker fires each cosmetic scriptlet with `executeJavaScript` inside a
 * try/catch that only sees synchronous throws, so a scriptlet that fails on a
 * hostile page rejects with nobody listening. Log it and carry on — a broken
 * filter on one page is not a reason to make noise on every page load.
 */
process.on('unhandledRejection', (reason) => {
  console.error('[voyager] unhandled rejection:', reason)
})

process.on('uncaughtException', (err) => {
  console.error('[voyager] uncaught:', err)
})

export { createWindow, windows }

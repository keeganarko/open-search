import { app, desktopCapturer, session, shell, webContents, type Session } from 'electron'
import { join, basename, extname } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { chmod, link, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { getSettings, isExcluded } from '../store/settings'
import { attachBlocker, detachBlocker, filterRequest } from './adblock'
import { matchesThreat } from '../security/threats'
import { configureSpellcheck } from '../security/spellcheck'
import { downloadRisk, executableContent, markDownloadedFile } from '../security/downloads'
import * as perms from './permissions'
import type { DownloadEntry } from '@shared/types'

const configured = new Set<string>()
const liveSessions = new Map<string, Session>()
const reservedDownloadPaths = new Set<string>()

const SEARCH_ACTION = {
  google: 'https://www.google.com/search',
  duckduckgo: 'https://duckduckgo.com/',
  brave: 'https://search.brave.com/search',
  kagi: 'https://kagi.com/search'
} as const

function newTabHtml(): string {
  const action = SEARCH_ACTION[getSettings().search.engine]
  const modifier = process.platform === 'darwin' ? '⌘' : 'Ctrl+'
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action https:">
<title>New Tab</title><style>
:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6f7;color:#1a1a1e}
main{width:min(620px,calc(100vw - 56px));transform:translateY(-8vh)}h1{font-size:28px;letter-spacing:-.04em;margin:0 0 22px;text-align:center}
form{display:flex;border:1px solid rgba(0,0,0,.12);border-radius:18px;background:#fff;box-shadow:0 10px 35px rgba(0,0,0,.08)}form:focus-within{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.16),0 10px 35px rgba(0,0,0,.08)}
input{width:100%;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:15px;padding:15px 18px}
p{text-align:center;color:#6b6b76;font-size:12px;margin-top:14px}@media(prefers-color-scheme:dark){body{background:#141416;color:#ececef}form{background:#1c1c20;border-color:rgba(255,255,255,.14);box-shadow:0 10px 35px rgba(0,0,0,.35)}p{color:#9a9aa4}}
</style></head><body><main><h1>Voyager</h1><form action="${action}" method="get"><input autofocus name="q" autocomplete="off" aria-label="Search" placeholder="Search the web"></form><p>${modifier}L focuses the address bar · ${modifier}K asks Voyager</p></main></body></html>`
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function errorHtml(url: URL): string {
  const target = url.searchParams.get('url') ?? ''
  const description = url.searchParams.get('description') ?? 'The page could not be reached.'
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Page unavailable</title><style>:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6f7;color:#1a1a1e}main{width:min(560px,calc(100vw - 56px))}h1{font-size:26px;margin:0 0 12px}p{color:#707078;line-height:1.5;overflow-wrap:anywhere}a{display:inline-block;margin-top:10px;padding:9px 14px;border-radius:8px;background:#6366f1;color:#fff;text-decoration:none}@media(prefers-color-scheme:dark){body{background:#141416;color:#ececef}p{color:#9a9aa4}}</style></head><body><main><h1>This page isn&apos;t available</h1><p>${escapeHtml(description)}</p><p>${escapeHtml(target)}</p>${/^https?:/i.test(target) ? `<a href="${escapeHtml(target)}">Try again</a>` : ''}</main></body></html>`
}

export function errorPageUrl(url: string, code: number, description: string): string {
  const query = new URLSearchParams({ url, code: String(code), description })
  return `voyager://error?${query}`
}

function registerVoyagerProtocol(ses: Session): void {
  if (ses.protocol.isProtocolHandled('voyager')) return
  ses.protocol.handle('voyager', (request) => {
    const url = new URL(request.url)
    const body = url.hostname === 'new-tab'
      ? newTabHtml()
      : url.hostname === 'error'
        ? errorHtml(url)
        : null
    if (body === null) {
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })
    }
    return new Response(body, {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    })
  })
}

const downloads: DownloadEntry[] = []
let onDownloadChange: (() => void) | null = null

export function listDownloads(): DownloadEntry[] {
  return downloads.slice(0, 100)
}
export function clearDownloads(): void {
  downloads.length = 0
  onDownloadChange?.()
}
export function watchDownloads(fn: () => void): void {
  onDownloadChange = fn
}

const downloadKey = (path: string): string => process.platform === 'win32' ? path.toLowerCase() : path

/** Collision-safe naming: report.pdf, report (1).pdf, report (2).pdf. */
export function uniqueDownloadPath(
  directory: string,
  requestedName: string,
  occupied: (path: string) => boolean = existsSync
): string {
  const filename = basename(requestedName) || 'download'
  const extension = extname(filename)
  const stem = filename.slice(0, filename.length - extension.length) || 'download'
  let n = 0
  while (true) {
    const name = n === 0 ? `${stem}${extension}` : `${stem} (${n})${extension}`
    const candidate = join(directory, name)
    if (!occupied(candidate) && !reservedDownloadPaths.has(downloadKey(candidate))) return candidate
    n++
  }
}

/**
 * Chromium ships a UA containing "Electron/x" and the app name; a number of
 * sites gate features or block outright on it. Stripping both tokens leaves a
 * standard browser UA for the Chromium build we are actually running.
 */
export function browserUserAgent(base: string): string {
  return base
    .replace(/\sElectron\/[\d.]+/, '')
    .replace(new RegExp(`\\s${app.getName()}\\/[\\d.]+`, 'i'), '')
}

export function sessionFor(partition: string, profileId: string): Session {
  const ses = session.fromPartition(partition)
  if (configured.has(partition)) return ses
  configured.add(partition)
  liveSessions.set(partition, ses)
  registerVoyagerProtocol(ses)

  ses.setUserAgent(browserUserAgent(ses.getUserAgent()))
  configureSpellcheck(ses, getSettings().privacy.spellcheckEnabled)

  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (matchesThreat(details.url)) return callback({ cancel: true })
    filterRequest(ses, details, callback)
  })

  // Read the setting per request so the toggle takes effect without a restart.
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    if (getSettings().privacy.sendDoNotTrack) {
      cb({ requestHeaders: { ...details.requestHeaders, DNT: '1', 'Sec-GPC': '1' } })
    } else {
      cb({ requestHeaders: details.requestHeaders })
    }
  })

  // A real request gets a real prompt. `permissions.decide` refuses an excluded
  // site, honours a standing answer, and only then puts a sheet on screen.
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const media = (details as { mediaTypes?: string[] } | undefined)?.mediaTypes
    void perms.decide(wc, permission, media, (u) => isExcluded(u), details.requestingUrl)
      .then(callback)
      .catch(() => callback(false))
  })

  // The synchronous path has to agree with the request handler above, or a page
  // is told it may go fullscreen and then finds it cannot. It cannot prompt, so
  // it answers from the stored decisions only.
  ses.setPermissionCheckHandler((wc, permission, origin, details) =>
    perms.check(wc, details.securityOrigin || details.requestingUrl || origin || '', permission,
      (u) => isExcluded(u), details.mediaType))

  // `getDisplayMedia` rejects outright unless a handler is installed — Chromium
  // does not fall back to its own picker in Electron. Consent first, then the
  // source list, because a page refused screen share should never see one.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    // `request.frame` is a WebFrameMain, not the WebContents everything else
    // here speaks in, so it has to be resolved back before use.
    const wc = request.frame ? webContents.fromFrame(request.frame) ?? null : null
    const frame = request.frame
    const url = frame?.url ?? ''
    const win = wc ? perms.windowFor(wc) : null
    const origin = perms.originOf(url)
    // An empty request is how you say no here — `callback({})` rejects the
    // page's promise, which is what a refusal should look like to the site.
    if (!wc || !win || !frame || !origin || origin !== request.securityOrigin
      || !request.userGesture || isExcluded(url)) return callback({})
    const profileId = win.profile.id
    let navigated = false
    const navigation = (): void => { navigated = true }
    wc.on('did-start-navigation', navigation)
    const valid = (): boolean => !navigated && !wc.isDestroyed() && !win.window.isDestroyed()
      && win.profile.id === profileId && request.frame === frame
      && frame.url === url && !isExcluded(url)

    try {
      const granted = await perms.decide(wc, 'display-capture', undefined, (u) => isExcluded(u), url)
      if (!granted || !valid()) return callback({})
      const sourceId = await perms.pickScreenSource(win, origin, valid)
      if (!sourceId || !valid()) return callback({})
      // The thumbnails from the picker are throwaway; the stream needs a source
      // fetched fresh, because the ids are only valid for the current enumeration.
      const picked = (await desktopCapturer.getSources({ types: ['screen', 'window'] }))
        .find((s) => s.id === sourceId)
      if (!picked || !valid()) return callback({})
      // Audio is deliberately not offered: macOS loopback capture needs a system
      // extension Electron does not ship, so promising it would be a lie.
      callback({ video: picked })
    } catch {
      callback({})
    } finally {
      wc.removeListener('did-start-navigation', navigation)
    }
  }, { useSystemPicker: false })

  // WebHID / WebSerial / WebUSB pick a *device* after the class permission was
  // granted. Chromium asks this for every device the page then opens, so it
  // answers from what was already decided rather than prompting all over again.
  // It carries an origin but no frame, so the profile comes from the session
  // this handler was installed on rather than from the requesting page.
  ses.setDevicePermissionHandler((details) =>
    perms.checkOrigin(profileId, details.origin, details.deviceType, (u) => isExcluded(u)))

  ses.on('will-download', (_e, item) => {
    const filename = item.getFilename()
    const sourceChain = item.getURLChain()
    const mimeType = item.getMimeType()
    const risk = downloadRisk(filename, sourceChain, mimeType)
    if (risk) {
      _e.preventDefault()
      downloads.unshift({ id: randomUUID(), filename, path: '', url: item.getURL(),
        bytes: item.getTotalBytes(), received: 0, state: 'blocked', reason: risk,
        startedAt: new Date().toISOString() })
      downloads.length = Math.min(downloads.length, 100)
      onDownloadChange?.()
      return
    }
    const target = uniqueDownloadPath(app.getPath('downloads'), item.getFilename())
    const quarantine = join(app.getPath('downloads'), '.voyager-quarantine')
    mkdirSync(quarantine, { recursive: true, mode: 0o700 })
    const staged = join(quarantine, `${randomUUID()}.download`)
    reservedDownloadPaths.add(downloadKey(target))
    item.setSavePath(staged)
    const entry: DownloadEntry = {
      id: `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      filename: item.getFilename(),
      path: target,
      url: item.getURL(),
      bytes: item.getTotalBytes(),
      received: 0,
      state: 'progressing',
      startedAt: new Date().toISOString()
    }
    downloads.unshift(entry)
    if (downloads.length > 100) downloads.length = 100
    item.on('updated', (_ev, state) => {
      entry.received = item.getReceivedBytes()
      entry.state = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing'
      onDownloadChange?.()
    })
    item.once('done', async (_ev, state) => {
      entry.state = state === 'completed' ? 'checking' : state
      entry.received = item.getReceivedBytes()
      onDownloadChange?.()
      try {
        if (state === 'completed') {
          await chmod(staged, 0o600)
          if (downloadRisk(filename, sourceChain, mimeType) || await executableContent(staged)) {
            throw new Error('The downloaded content is unsafe or executable.')
          }
          await markDownloadedFile(staged)
          // Same-filesystem hard link publishes already-marked bytes atomically,
          // and fails if another download or process claimed the destination.
          await link(staged, target)
          entry.state = 'completed'
          entry.path = target
        }
      } catch {
        entry.state = 'blocked'
        entry.path = ''
        entry.reason = 'The file failed safety or Internet-origin marking checks.'
      } finally {
        await unlink(staged).catch(() => {})
        reservedDownloadPaths.delete(downloadKey(target))
        onDownloadChange?.()
      }
    })
    onDownloadChange?.()
  })

  const privacy = getSettings().privacy
  if (privacy.blockAds || privacy.blockTrackers) {
    void attachBlocker(ses)
  }

  return ses
}

/** Apply ad/tracker toggles to every partition that is already running. */
export async function refreshSessionPrivacy(): Promise<void> {
  const privacy = getSettings().privacy
  configureSpellcheck(session.defaultSession, privacy.spellcheckEnabled)
  const enabled = privacy.blockAds || privacy.blockTrackers
  await Promise.all([...liveSessions.values()].map(async (ses) => {
    try {
      configureSpellcheck(ses, privacy.spellcheckEnabled)
      enabled ? await attachBlocker(ses) : await detachBlocker(ses)
    } catch (err) {
      console.error('[voyager] could not update blocker state:', err)
    }
  }))
}

/** Open a URL in the user's default browser, refusing non-web schemes. */
export function openExternal(url: string): void {
  try {
    const u = new URL(url)
    if (matchesThreat(url)) return
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') {
      void shell.openExternal(url)
    }
  } catch { /* not a URL — ignore */ }
}

export async function clearBrowsingData(partition: string): Promise<void> {
  const ses = session.fromPartition(partition)
  await ses.clearStorageData({
    storages: [
      'cookies', 'localstorage', 'indexdb', 'cachestorage',
      'serviceworkers', 'filesystem'
    ]
  })
  await ses.clearCache()
}

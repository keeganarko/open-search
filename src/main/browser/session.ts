import { app, desktopCapturer, session, shell, webContents, type Session } from 'electron'
import { join } from 'node:path'
import { getSettings, isExcluded } from '../store/settings'
import { attachBlocker } from './adblock'
import * as perms from './permissions'
import type { DownloadEntry } from '@shared/types'

const configured = new Set<string>()

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

/**
 * Chromium ships a UA containing "Electron/x" and the app name; a number of
 * sites gate features or block outright on it. Stripping both tokens leaves a
 * genuine Chrome UA for the Chromium build we are actually running.
 */
export function chromeUserAgent(base: string): string {
  return base
    .replace(/\sElectron\/[\d.]+/, '')
    .replace(new RegExp(`\\s${app.getName()}\\/[\\d.]+`, 'i'), '')
    .replace(/\sKia\/[\d.]+/i, '')
}

export function sessionFor(partition: string, profileId: string): Session {
  const ses = session.fromPartition(partition)
  if (configured.has(partition)) return ses
  configured.add(partition)

  ses.setUserAgent(chromeUserAgent(ses.getUserAgent()))

  const settings = getSettings()

  if (settings.privacy.sendDoNotTrack) {
    ses.webRequest.onBeforeSendHeaders((details, cb) => {
      cb({ requestHeaders: { ...details.requestHeaders, DNT: '1', 'Sec-GPC': '1' } })
    })
  }

  // A real request gets a real prompt. `permissions.decide` refuses an excluded
  // site, honours a standing answer, and only then puts a sheet on screen.
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const media = (details as { mediaTypes?: string[] } | undefined)?.mediaTypes
    void perms.decide(wc, permission, media, (u) => isExcluded(u))
      .then(callback)
      .catch(() => callback(false))
  })

  // The synchronous path has to agree with the request handler above, or a page
  // is told it may go fullscreen and then finds it cannot. It cannot prompt, so
  // it answers from the stored decisions only.
  ses.setPermissionCheckHandler((wc, permission, origin) =>
    perms.check(wc, wc?.getURL() || origin || '', permission))

  // `getDisplayMedia` rejects outright unless a handler is installed — Chromium
  // does not fall back to its own picker in Electron. Consent first, then the
  // source list, because a page refused screen share should never see one.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    // `request.frame` is a WebFrameMain, not the WebContents everything else
    // here speaks in, so it has to be resolved back before use.
    const wc = request.frame ? webContents.fromFrame(request.frame) ?? null : null
    const url = wc?.getURL() ?? ''
    const win = wc ? perms.windowFor(wc) : null
    const origin = perms.originOf(url)
    // An empty request is how you say no here — `callback({})` rejects the
    // page's promise, which is what a refusal should look like to the site.
    if (!wc || !win || !origin || isExcluded(url)) return callback({})

    const granted = await perms.decide(wc, 'display-capture', undefined, (u) => isExcluded(u))
    if (!granted) return callback({})
    const sourceId = await perms.pickScreenSource(win, origin)
    if (!sourceId) return callback({})
    // The thumbnails from the picker are throwaway; the stream needs a source
    // fetched fresh, because the ids are only valid for the current enumeration.
    const picked = (await desktopCapturer.getSources({ types: ['screen', 'window'] }))
      .find((s) => s.id === sourceId)
    if (!picked) return callback({})
    // Audio is deliberately not offered: macOS loopback capture needs a system
    // extension Electron does not ship, so promising it would be a lie.
    callback({ video: picked })
  }, { useSystemPicker: false })

  // WebHID / WebSerial / WebUSB pick a *device* after the class permission was
  // granted. Chromium asks this for every device the page then opens, so it
  // answers from what was already decided rather than prompting all over again.
  // It carries an origin but no frame, so the profile comes from the session
  // this handler was installed on rather than from the requesting page.
  ses.setDevicePermissionHandler((details) =>
    perms.checkOrigin(profileId, details.origin, details.deviceType))

  ses.on('will-download', (_e, item) => {
    const target = join(app.getPath('downloads'), item.getFilename())
    item.setSavePath(target)
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
    item.once('done', (_ev, state) => {
      entry.state = state
      entry.received = item.getReceivedBytes()
      entry.path = item.getSavePath()
      onDownloadChange?.()
    })
    onDownloadChange?.()
  })

  if (settings.privacy.blockAds || settings.privacy.blockTrackers) {
    void attachBlocker(ses)
  }

  return ses
}

/** Open a URL in the user's default browser, refusing non-web schemes. */
export function openExternal(url: string): void {
  try {
    const u = new URL(url)
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') {
      void shell.openExternal(url)
    }
  } catch { /* not a URL — ignore */ }
}

export async function clearBrowsingData(partition: string): Promise<void> {
  const ses = session.fromPartition(partition)
  await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'cachestorage'] })
  await ses.clearCache()
}

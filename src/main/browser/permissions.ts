import { desktopCapturer, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import type { PermissionAsk } from '@shared/types'
import * as db from '../store/db'
import { post, type KiaWindow } from './window'

/**
 * Granted without asking because none of them reveal anything about the user or
 * their machine — they only change how the page draws itself or what it may do
 * with input it already has.
 *
 * `setPermissionCheckHandler` is synchronous and cannot prompt, so it consults
 * this set and the stored decisions and nothing else. The two handlers must
 * agree: a page told it may go fullscreen and then refused is worse than a
 * page told no up front.
 */
export const AUTO_GRANTED = new Set([
  'fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock'
])

/**
 * Everything here gets a prompt the first time an origin asks. Anything absent
 * from both sets is refused outright — Chromium adds permission strings between
 * releases, and a name Open Search has never heard of is not one to grant blind.
 */
const ASKABLE = new Set([
  'media', 'geolocation', 'notifications', 'display-capture', 'clipboard-read',
  'midi', 'midiSysex', 'idle-detection', 'window-management', 'speaker-selection',
  'storage-access', 'top-level-storage-access', 'hid', 'serial', 'usb'
])

/** Human wording for the sheet. Kept here so main and renderer cannot drift. */
export const PERMISSION_LABEL: Record<string, string> = {
  media: 'use your camera and microphone',
  'media:audio': 'use your microphone',
  'media:video': 'use your camera',
  geolocation: 'know your location',
  notifications: 'send you notifications',
  'display-capture': 'share your screen',
  'clipboard-read': 'read your clipboard',
  midi: 'use MIDI devices',
  midiSysex: 'send system messages to MIDI devices',
  'idle-detection': 'know when you are away from the computer',
  'window-management': 'see the layout of your displays',
  'speaker-selection': 'choose which speaker plays audio',
  'storage-access': 'use its cookies inside this site',
  'top-level-storage-access': 'use its cookies across sites',
  hid: 'connect to a USB input device',
  serial: 'connect to a serial device',
  usb: 'connect to a USB device'
}

/** Scheme + host + port. What a decision is remembered against. */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return u.origin
  } catch { return null }
}

interface Pending {
  ask: PermissionAsk
  resolve: (allowed: boolean) => void
  win: KiaWindow
}

const pending = new Map<string, Pending>()

/** Set once at startup; maps a requesting webContents to the window it lives in. */
let resolveWindow: ((wc: WebContents) => KiaWindow | null) | null = null
export function setWindowResolver(fn: (wc: WebContents) => KiaWindow | null): void {
  resolveWindow = fn
}

function show(win: KiaWindow): void {
  const asks = [...pending.values()].filter((p) => p.win === win).map((p) => p.ask)
  if (asks.length) win.showOverlay({ kind: 'permission', asks })
  else if (win.overlayMode.kind === 'permission') win.closeOverlay()
}

/**
 * Resolves when the user answers. A request whose tab goes away resolves to
 * false rather than hanging: Chromium holds the page's promise open until this
 * callback fires, so a leaked pending entry is a page that never gets an answer.
 */
export function ask(
  win: KiaWindow, wc: WebContents, origin: string, permission: string, mediaTypes?: string[]
): Promise<boolean> {
  return new Promise((resolve) => {
    const id = `pm_${randomUUID()}`
    let settled = false
    const done = (allowed: boolean): void => {
      if (settled) return
      settled = true
      pending.delete(id)
      show(win)
      resolve(allowed)
    }
    pending.set(id, { ask: { id, origin, permission, mediaTypes }, resolve: done, win })
    wc.once('destroyed', () => done(false))
    show(win)
  })
}

/** The renderer's answer. `remember` writes a standing decision for the origin. */
export function respond(id: string, allowed: boolean, remember: boolean): void {
  const p = pending.get(id)
  if (!p) return
  if (remember) db.recordPermission(p.win.profile.id, p.ask.origin, p.ask.permission, allowed)
  p.resolve(allowed)
}

/** Deny everything still outstanding for a window that is going away. */
export function cancelFor(win: KiaWindow): void {
  for (const [, p] of pending) if (p.win === win) p.resolve(false)
}

// ——— screen sharing ————————————————————————————————————————

interface PickPending {
  resolve: (id: string | null) => void
  win: KiaWindow
}
let pickPending: PickPending | null = null

/**
 * `getDisplayMedia` fails outright unless a display-media handler is installed,
 * so Chromium's own picker is not available to us — the source list and the
 * choosing both have to happen here.
 */
export async function pickScreenSource(win: KiaWindow, origin: string): Promise<string | null> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: true
  })
  return new Promise((resolve) => {
    let settled = false
    const done = (id: string | null): void => {
      if (settled) return
      settled = true
      pickPending = null
      win.closeOverlay()
      resolve(id)
    }
    pickPending = { resolve: done, win }
    win.showOverlay({
      kind: 'screenPick',
      origin,
      sources: sources.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.id.startsWith('screen:') ? 'screen' : 'window',
        thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
        icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null
      }))
    })
  })
}

export function respondScreenPick(sourceId: string | null): void {
  pickPending?.resolve(sourceId)
}

// ——— the handlers ——————————————————————————————————————————

/**
 * `permission` is Chromium's own string, passed straight through. The order
 * matters: an excluded site is refused before it can be asked about, and a
 * stored decision beats a fresh prompt.
 */
export async function decide(
  wc: WebContents | null, permission: string, mediaTypes: string[] | undefined,
  excluded: (url: string) => boolean
): Promise<boolean> {
  if (AUTO_GRANTED.has(permission)) return true
  if (!ASKABLE.has(permission)) return false
  if (!wc) return false

  const url = wc.getURL()
  if (excluded(url)) return false
  const origin = originOf(url)
  if (!origin) return false

  const win = resolveWindow?.(wc) ?? null
  if (!win) return false

  const stored = db.permissionDecision(win.profile.id, origin, permission)
  if (stored !== null) return stored

  return ask(win, wc, origin, permission, mediaTypes)
}

/**
 * Synchronous counterpart, used by `setPermissionCheckHandler`. It cannot
 * prompt, so "never asked" has to read as no — which is exactly right, because
 * the async handler is what turns a real request into a prompt.
 */
export function check(wc: WebContents | null, url: string, permission: string): boolean {
  if (AUTO_GRANTED.has(permission)) return true
  const origin = originOf(url)
  if (!origin) return false
  const win = wc ? resolveWindow?.(wc) ?? null : null
  if (!win) return false
  return db.permissionDecision(win.profile.id, origin, permission) === true
}

/**
 * For handlers that get an origin but no frame — `setDevicePermissionHandler`
 * carries neither a WebContents nor a WebFrameMain, so the profile has to come
 * from the session the handler was installed on.
 */
export function checkOrigin(profileId: string, origin: string, permission: string): boolean {
  if (AUTO_GRANTED.has(permission)) return true
  const o = originOf(origin)
  if (!o) return false
  return db.permissionDecision(profileId, o, permission) === true
}

/** The window a webContents belongs to, or null. Used by the session wiring. */
export function windowFor(wc: WebContents): KiaWindow | null {
  return resolveWindow?.(wc) ?? null
}

export { post }

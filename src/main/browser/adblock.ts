import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type { Session } from 'electron'

let blockerPromise: Promise<ElectronBlocker> | null = null
let readyBlocker: ElectronBlocker | null = null
const attached = new WeakSet<Session>()
const counted = new WeakSet<ElectronBlocker>()

/** Counters the UI shows per tab; keyed by the tab's webContents id. */
const counts = new Map<number, number>()
const countListeners = new Set<(webContentsId: number, count: number) => void>()

function cachePath(): string {
  return join(app.getPath('userData'), 'adblock', 'engine.bin')
}

async function loadBlocker(): Promise<ElectronBlocker> {
  const path = cachePath()
  const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
    path,
    read: async (p) => readFile(p),
    write: async (p, buf) => {
      await mkdir(dirname(p), { recursive: true })
      await writeFile(p, buf)
    }
  })
  // The blocker instance is shared by every profile session. Installing this
  // inside `attachBlocker` counted one request once per profile.
  if (!counted.has(blocker)) {
    counted.add(blocker)
    blocker.on('request-blocked', (request: { tabId: number }) => {
      const count = (counts.get(request.tabId) ?? 0) + 1
      counts.set(request.tabId, count)
      for (const listener of countListeners) listener(request.tabId, count)
    })
  }
  return blocker
}

export async function attachBlocker(ses: Session): Promise<void> {
  if (attached.has(ses)) return
  attached.add(ses)
  try {
    blockerPromise ??= loadBlocker()
    const blocker = await blockerPromise
    readyBlocker = blocker
  } catch (err) {
    // A failed filter-list fetch must not stop the browser from starting.
    console.error('[voyager] ad blocker unavailable:', err)
    attached.delete(ses)
    blockerPromise = null
  }
}

export async function detachBlocker(ses: Session): Promise<void> {
  attached.delete(ses)
}

// Voyager owns the one Electron request listener. Disabling ads must never
// uninstall malware protection. Cosmetic script injection is not enabled.
export function filterRequest(ses: Session, details: Electron.OnBeforeRequestListenerDetails,
  callback: (response: Electron.CallbackResponse) => void): void {
  if (attached.has(ses) && readyBlocker) readyBlocker.onBeforeRequest(details, callback)
  else callback({})
}

export function blockedCount(webContentsId: number): number {
  return counts.get(webContentsId) ?? 0
}

export function resetCount(webContentsId: number): void {
  counts.delete(webContentsId)
  for (const listener of countListeners) listener(webContentsId, 0)
}

export function watchBlockedCounts(
  listener: (webContentsId: number, count: number) => void
): () => void {
  countListeners.add(listener)
  return () => { countListeners.delete(listener) }
}

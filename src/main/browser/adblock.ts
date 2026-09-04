import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type { Session } from 'electron'

let blockerPromise: Promise<ElectronBlocker> | null = null
const attached = new WeakSet<Session>()

/** Counters the UI shows per tab; keyed by the tab's webContents id. */
const counts = new Map<number, number>()

function cachePath(): string {
  return join(app.getPath('userData'), 'adblock', 'engine.bin')
}

async function loadBlocker(): Promise<ElectronBlocker> {
  const path = cachePath()
  return ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
    path,
    read: async (p) => readFile(p),
    write: async (p, buf) => {
      await mkdir(dirname(p), { recursive: true })
      await writeFile(p, buf)
    }
  })
}

export async function attachBlocker(ses: Session): Promise<void> {
  if (attached.has(ses)) return
  attached.add(ses)
  try {
    blockerPromise ??= loadBlocker()
    const blocker = await blockerPromise
    blocker.enableBlockingInSession(ses)
    blocker.on('request-blocked', (request: { tabId: number }) => {
      counts.set(request.tabId, (counts.get(request.tabId) ?? 0) + 1)
    })
  } catch (err) {
    // A failed filter-list fetch must not stop the browser from starting.
    console.error('[kia] ad blocker unavailable:', err)
    attached.delete(ses)
  }
}

export async function detachBlocker(ses: Session): Promise<void> {
  if (!blockerPromise) return
  const blocker = await blockerPromise
  blocker.disableBlockingInSession(ses)
  attached.delete(ses)
}

export function blockedCount(webContentsId: number): number {
  return counts.get(webContentsId) ?? 0
}

export function resetCount(webContentsId: number): void {
  counts.delete(webContentsId)
}

import type { VoyagerWindow } from './window'
import { callPage } from './pageBridge'
import { getSettings, isExcluded } from '../store/settings'

interface Draft {
  tabId: string
  text: string | null
  valid: () => boolean
  dispose: () => void
}
const drafts = new WeakMap<VoyagerWindow, Draft>()

/** A reviewed rewrite belongs to one document, even across async AI work. */
export function beginWriting(win: VoyagerWindow, tabId?: string): {
  finish: (text: string) => void; cancel: () => void
} {
  drafts.get(win)?.dispose()
  const manager = win.tabs
  const tab = manager.get(tabId ?? manager.activeId ?? '')
  if (!tab) throw new Error('No page is available for rewriting.')
  const wc = tab.view.webContents
  const url = wc.getURL()
  const profileId = win.profile.id
  let invalid = false
  let entry: Draft
  const dispose = (): void => {
    invalid = true
    clearTimeout(timeout)
    wc.removeListener('did-start-navigation', navigation)
    wc.removeListener('destroyed', dispose)
    if (drafts.get(win) === entry) drafts.delete(win)
  }
  const navigation = (event: { isMainFrame: boolean }): void => {
    if (event.isMainFrame) dispose()
  }
  const valid = (): boolean => !invalid && !wc.isDestroyed() && !win.window.isDestroyed()
    && win.profile.id === profileId && win.tabs === manager && manager.get(tab.id) === tab
    && wc.getURL() === url && !getSettings().privacy.paused && !isExcluded(url)
  const timeout = setTimeout(dispose, 5 * 60_000)
  timeout.unref?.()
  entry = { tabId: tab.id, text: null, valid, dispose }
  drafts.set(win, entry)
  wc.on('did-start-navigation', navigation)
  wc.once('destroyed', dispose)
  return {
    cancel: dispose,
    finish: (text) => {
      if (!valid()) { dispose(); throw new Error('The page changed. Select the text and rewrite it again.') }
      entry.text = text
    }
  }
}

export async function applyWriting(
  win: VoyagerWindow, text: string, replace: boolean, tabId?: string
): Promise<boolean> {
  const entry = drafts.get(win)
  if (!entry) return false
  if (!entry.valid() || entry.text !== text || entry.tabId !== (tabId ?? win.tabs.activeId)
    || entry.tabId !== win.tabs.activeId) {
    entry.dispose()
    return false
  }
  const wc = win.tabs.get(entry.tabId)!.view.webContents
  // Consume the approval once. callPage checks the URL again inside the document.
  entry.dispose()
  return (await callPage<boolean>(wc, 'insertText', { text, replace })) ?? false
}

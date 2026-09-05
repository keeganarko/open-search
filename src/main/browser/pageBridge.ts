import type { WebContents } from 'electron'

/**
 * Electron runs a sandboxed preload in isolated world 999. Calls made through
 * this helper execute in that same world, so page helpers never have to be
 * exposed on the website's `window` object (where a site could fingerprint or
 * replace them).
 */
const PRELOAD_WORLD_ID = 999

type PageMethod = 'extract' | 'selection' | 'insertText' | 'selectionRect' | 'hasLoginForm' | 'meta'
  | 'agentSnapshot' | 'agentPrepare' | 'agentAct' | 'agentStartRecording' | 'agentRecording' | 'agentStopRecording' | 'agentDiagnostics'

export async function callPage<T>(
  webContents: WebContents,
  method: PageMethod,
  ...args: unknown[]
): Promise<T | null> {
  if (webContents.isDestroyed()) return null
  const url = webContents.getURL()
  let navigated = false
  const onNavigation = (event: { isMainFrame: boolean }): void => {
    if (event.isMainFrame) navigated = true
  }
  webContents.on('did-start-navigation', onNavigation)
  const methodJson = JSON.stringify(method)
  const argsJson = JSON.stringify(args)
  const code = `location.href === ${JSON.stringify(url)} ? (globalThis.__voyagerPage?.[${methodJson}]?.(...${argsJson}) ?? null) : null`
  try {
    const result = await webContents.executeJavaScriptInIsolatedWorld(
      PRELOAD_WORLD_ID, [{ code }], false
    ) as T | null
    return !navigated && !webContents.isDestroyed() && webContents.getURL() === url ? result : null
  } finally {
    webContents.removeListener('did-start-navigation', onNavigation)
  }
}

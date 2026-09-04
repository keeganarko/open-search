import type { WebContents } from 'electron'

/**
 * Electron runs a sandboxed preload in isolated world 999. Calls made through
 * this helper execute in that same world, so page helpers never have to be
 * exposed on the website's `window` object (where a site could fingerprint or
 * replace them).
 */
const PRELOAD_WORLD_ID = 999

type PageMethod = 'extract' | 'selection' | 'insertText' | 'selectionRect' | 'hasLoginForm' | 'meta'

export async function callPage<T>(
  webContents: WebContents,
  method: PageMethod,
  ...args: unknown[]
): Promise<T | null> {
  if (webContents.isDestroyed()) return null
  const methodJson = JSON.stringify(method)
  const argsJson = JSON.stringify(args)
  const code = `globalThis.__voyagerPage?.[${methodJson}]?.(...${argsJson}) ?? null`
  return webContents.executeJavaScriptInIsolatedWorld(
    PRELOAD_WORLD_ID,
    [{ code }],
    true
  ) as Promise<T | null>
}

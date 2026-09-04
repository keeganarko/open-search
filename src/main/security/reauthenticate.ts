import { app, systemPreferences, type BaseWindow } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

const exec = promisify(execFile)
const pending = new WeakSet<BaseWindow>()

/** No confirmation-only fallback, cached approvals, or password collection in HTML. */
export async function reauthenticate(window: BaseWindow): Promise<boolean> {
  if (window.isDestroyed() || pending.has(window)) return false
  pending.add(window)
  try {
    if (process.platform === 'darwin' && systemPreferences.canPromptTouchID()) {
      await systemPreferences.promptTouchID('reveal a saved password in Voyager')
      return !window.isDestroyed()
    }
    if (process.platform === 'win32') {
      const handle = window.getNativeWindowHandle()
      const hwnd = (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString()
      const root = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
      const { stdout } = await exec(join(root, 'native/voyager-auth.exe'), [hwnd], {
        windowsHide: true, timeout: 60_000, maxBuffer: 128, encoding: 'utf8'
      })
      return stdout === 'VERIFIED' && !window.isDestroyed()
    }
    return false
  } catch { return false } finally { pending.delete(window) }
}

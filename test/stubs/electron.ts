/**
 * Everything under `src/main` reaches for `electron` at import time, and none of
 * it is available outside a running Electron process. The alias in
 * `vitest.config.ts` points at this file, so the pure logic underneath stays
 * testable. Anything a test actually depends on gets a real implementation
 * here; the rest exists only so the import resolves.
 */
export const app = {
  getPath: (name: string) => `/tmp/voyager-test/${name}`,
  getAppPath: () => process.cwd(),
  getName: () => 'Voyager',
  getVersion: () => '0.0.0-test',
  setName: () => {},
  isPackaged: false,
  on: () => {},
  whenReady: () => Promise.resolve()
}

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer) => b.toString('utf8')
}

export const session = { fromPartition: () => ({}) }
export const shell = { openExternal: () => Promise.resolve() }
export const dialog = {}
export const nativeTheme = {}
export const desktopCapturer = { getSources: () => Promise.resolve([]) }
export const webContents = { fromFrame: () => null }
export const ipcMain = { handle: () => {}, on: () => {} }
export const ipcRenderer = { send: () => {}, on: () => {}, invoke: () => Promise.resolve() }
export const contextBridge = { exposeInMainWorld: () => {} }
export const Menu = { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) }
export class MenuItem {}
export class BrowserWindow {}
export class BaseWindow {}
export class WebContentsView {}
export default { app, safeStorage, session, shell }

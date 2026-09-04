import { app, dialog } from 'electron'
import updater from 'electron-updater'
import { readFileSync, createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { matchUpdateFiles, newerVersion, RELEASE_ROOT, verifyRelease, type SignedRelease } from './updateManifest'

const { autoUpdater } = updater
let status = 'Automatic updates are not configured for this build.'
let busy = false
let verified = false
let initialized = false
let keys: string[] = []
let pending: { file: string; release: SignedRelease } | null = null
export const updateStatus = (): string => status

export async function initializeUpdates(): Promise<void> {
  if (initialized) return
  initialized = true
  try {
    keys = JSON.parse(readFileSync(join(app.getAppPath(), 'resources/security/update-keys.json'), 'utf8'))
    if (!Array.isArray(keys) || !keys.length || !keys.every((k) => typeof k === 'string')) return
  } catch { return }
  if (!app.isPackaged) { status = 'Automatic updates run in packaged builds.'; return }
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false
  autoUpdater.disableWebInstaller = true
  autoUpdater.disableDifferentialDownload = true
  if (process.platform === 'win32') {
    try {
      // electron-updater otherwise skips Authenticode when publisherName is absent.
      const config = await (autoUpdater as unknown as { configOnDisk: { value: Promise<{ publisherName?: unknown }> } }).configOnDisk.value
      const names = Array.isArray(config.publisherName) ? config.publisherName : [config.publisherName]
      if (!names.length || !names.every((name) => typeof name === 'string' && name.trim())) throw new Error('Missing publisher')
    } catch {
      keys = []
      status = 'Updates are disabled because this build has no verified publisher configuration.'
      return
    }
  }
  autoUpdater.on('error', () => { status = 'Update check failed. Please try again.' })
  status = 'Signed update checks are enabled.'
  setTimeout(() => void checkForUpdates(), 30_000).unref()
  setInterval(() => void checkForUpdates(), 4 * 3600_000).unref()
}

export async function checkForUpdates(): Promise<string> {
  if (!initialized || !app.isPackaged || !keys.length || busy) return status
  busy = true
  try {
    if (pending && verified) { await installPending(); return status }
    status = 'Checking for signed updates…'
    const response = await fetch(`${RELEASE_ROOT}/latest/download/voyager-security.json`, {
      signal: AbortSignal.timeout(20_000), redirect: 'follow', credentials: 'omit'
    })
    if (!response.ok) throw new Error('No signed release is available.')
    // The manifest is public data. No local records, cookies or tokens are sent.
    const reader = response.body!.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > 64 * 1024) { await reader.cancel(); throw new Error('Manifest too large.') }
      chunks.push(value)
    }
    const release = verifyRelease(Buffer.concat(chunks).toString('utf8'), keys)
    if (!newerVersion(release.version, app.getVersion())) return status = 'Voyager is up to date.'
    autoUpdater.setFeedURL({ provider: 'generic', url: `${RELEASE_ROOT}/download/v${release.version}/` })
    const check = await autoUpdater.checkForUpdates()
    if (!check) throw new Error('Update service is unavailable.')
    matchUpdateFiles(release, check.updateInfo)
    status = `Downloading Voyager ${release.version}…`
    const files = await autoUpdater.downloadUpdate()
    if (files.length !== 1) throw new Error('Unexpected update payload.')
    await verifyDownloadedFile(files[0], release)
    // Never auto-install until both the signed manifest and the actual bytes pass.
    verified = true
    pending = { file: files[0], release }
    status = `Voyager ${release.version} is ready. Restart to install.`
    await installPending()
  } catch {
    verified = false
    pending = null
    autoUpdater.autoInstallOnAppQuit = false
    status = 'Could not verify an update. Nothing was installed.'
  } finally { busy = false }
  return status
}

async function installPending(): Promise<void> {
  if (!pending) return
  const answer = await dialog.showMessageBox({
    type: 'info', title: 'Voyager security update', message: status,
    buttons: ['Later', 'Restart and install'], defaultId: 1, cancelId: 0, noLink: true
  })
  if (answer.response === 1) {
    await verifyDownloadedFile(pending.file, pending.release)
    autoUpdater.quitAndInstall(false, true)
  }
}

async function verifyDownloadedFile(file: string, release: SignedRelease): Promise<void> {
  const info = await stat(file)
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  const digest = hash.digest('base64')
  if (!release.files.some((f) => f.sha512 === digest && f.size === info.size)) {
    throw new Error('Downloaded update failed signature verification.')
  }
  if (Date.parse(release.expiresAt) <= Date.now()) throw new Error('Release signature has expired.')
}

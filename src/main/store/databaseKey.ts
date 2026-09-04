import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, mkdirSync, renameSync, statSync, openSync, closeSync, fsyncSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { hasSecureStorage } from './secureStorage'
import { durableWrite, isPlaintextDatabase } from './encryptedDatabase'

function syncDirectory(directory: string): void {
  if (process.platform === 'win32') return
  const fd = openSync(directory, 'r')
  try { fsyncSync(fd) } finally { closeSync(fd) }
}

export function databaseKey(): Buffer {
  // Dedicated packaged Linux tests can exercise renderer/network boundaries on
  // a host without a desktop vault. This branch is removed from release builds;
  // the test report separately FAILS its OS-vault check. The disposable key is
  // never saved, so this path cannot open a retained browser profile.
  if (typeof __SECURITY_TEST__ !== 'undefined' && __SECURITY_TEST__ && process.platform === 'linux' && !hasSecureStorage()) return randomBytes(32)
  if (!hasSecureStorage()) {
    throw new Error('Unlock your operating-system keychain to open Voyager. Browser records cannot be stored without encryption.')
  }
  const directory = app.getPath('userData')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, 'database-key.enc')
  if (!existsSync(path) && existsSync(`${path}.tmp`)) {
    const hex = safeStorage.decryptString(readFileSync(`${path}.tmp`))
    if (!/^[a-f0-9]{64}$/.test(hex)) throw new Error('The pending database key cannot be recovered.')
    renameSync(`${path}.tmp`, path)
    syncDirectory(directory)
  }
  if (existsSync(path)) {
    const hex = safeStorage.decryptString(readFileSync(path))
    if (!/^[a-f0-9]{64}$/.test(hex)) throw new Error('The database key is invalid. Restore your protected key backup.')
    return Buffer.from(hex, 'hex')
  }
  const database = join(directory, 'voyager.db')
  if (existsSync(database) && statSync(database).size > 0 && !isPlaintextDatabase(database)) {
    throw new Error('The protected key for this encrypted database is missing. Restore the original key; a replacement cannot unlock it.')
  }
  const key = randomBytes(32)
  const wrapped = safeStorage.encryptString(key.toString('hex'))
  durableWrite(`${path}.tmp`, wrapped, true)
  renameSync(`${path}.tmp`, path)
  syncDirectory(directory)
  return key
}

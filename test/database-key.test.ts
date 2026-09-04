import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { databaseKey } from '../src/main/store/databaseKey'

const dirs: string[] = []
function setup(): string {
  const dir = mkdtempSync(join(tmpdir(), 'voyager-vault-test-'))
  dirs.push(dir)
  vi.spyOn(app, 'getPath').mockReturnValue(dir)
  vi.spyOn(safeStorage, 'isEncryptionAvailable').mockReturnValue(true)
  vi.spyOn(safeStorage, 'getSelectedStorageBackend').mockReturnValue('gnome_libsecret')
  return dir
}
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
describe('database key custody', () => {
  it('refuses to replace a missing key for an encrypted database', () => {
    const dir = setup()
    writeFileSync(join(dir, 'voyager.db'), 'encrypted database fixture')
    const encrypt = vi.spyOn(safeStorage, 'encryptString')
    expect(() => databaseKey()).toThrow(/missing/)
    expect(encrypt).not.toHaveBeenCalled()
    expect(existsSync(join(dir, 'database-key.enc'))).toBe(false)
  })
  it('recovers a durably written pending key after an interrupted rename', () => {
    const dir = setup()
    const hex = 'ab'.repeat(32)
    writeFileSync(join(dir, 'database-key.enc.tmp'), hex)
    writeFileSync(join(dir, 'voyager.db'), 'encrypted database fixture')
    expect(databaseKey()).toEqual(Buffer.from(hex, 'hex'))
    expect(readFileSync(join(dir, 'database-key.enc'), 'utf8')).toBe(hex)
    expect(existsSync(join(dir, 'database-key.enc.tmp'))).toBe(false)
  })
  it('does not write any key without protected OS storage', () => {
    const dir = setup()
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
    expect(() => databaseKey()).toThrow(/keychain/)
    expect(existsSync(join(dir, 'database-key.enc'))).toBe(false)
  })
})

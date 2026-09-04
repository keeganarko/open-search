import { afterEach, describe, expect, it, vi } from 'vitest'
import { safeStorage } from 'electron'
import { hasSecureStorage } from '../src/main/store/secureStorage'

describe('credential storage', () => {
  afterEach(() => vi.restoreAllMocks())
  it('refuses an unavailable credential store', () => {
    vi.spyOn(safeStorage, 'isEncryptionAvailable').mockReturnValue(false)
    expect(hasSecureStorage()).toBe(false)
  })
  it.runIf(process.platform === 'linux')('refuses Linux fixed-key basic_text encryption', () => {
    vi.spyOn(safeStorage, 'isEncryptionAvailable').mockReturnValue(true)
    vi.spyOn(safeStorage, 'getSelectedStorageBackend').mockReturnValue('basic_text')
    expect(hasSecureStorage()).toBe(false)
  })
  it('accepts an available OS credential store', () => {
    vi.spyOn(safeStorage, 'isEncryptionAvailable').mockReturnValue(true)
    vi.spyOn(safeStorage, 'getSelectedStorageBackend').mockReturnValue('gnome_libsecret')
    expect(hasSecureStorage()).toBe(true)
  })
})

import { safeStorage } from 'electron'

/** Linux's basic_text backend uses a fixed key, not an OS credential vault. */
export function hasSecureStorage(): boolean {
  return safeStorage.isEncryptionAvailable()
    && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
}

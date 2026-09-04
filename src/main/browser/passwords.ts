import { safeStorage } from 'electron'
import type { SavedLogin } from '@shared/types'
import * as db from '../store/db'
import { originOf } from './permissions'

/**
 * Passwords are encrypted with the OS keychain before they reach SQLite, so the
 * database file on disk holds no readable secret. Without a keychain there is
 * nothing honest to fall back to — refusing to save beats writing plaintext and
 * calling it a password manager.
 */
export function canSave(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/** Never place a reusable password into an insecure remote HTTP page. */
export function isSecureLoginUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:'
      || (parsed.protocol === 'http:'
        && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
  } catch {
    return false
  }
}

function encrypt(password: string): string {
  return safeStorage.encryptString(password).toString('base64')
}

function decrypt(blob: string): string | null {
  try { return safeStorage.decryptString(Buffer.from(blob, 'base64')) } catch { return null }
}

export function list(profileId: string, url?: string): SavedLogin[] {
  if (url === undefined) return db.listLogins(profileId)
  const origin = originOf(url)
  return origin ? db.listLogins(profileId, origin) : []
}

export function save(
  profileId: string, url: string, username: string, password: string
): SavedLogin | null {
  const origin = originOf(url)
  if (!origin || !isSecureLoginUrl(url) || !username || !password || !canSave()) return null
  return db.upsertLogin(profileId, origin, username, encrypt(password))
}

/**
 * The only path a stored password takes back out. Everything else — the panel,
 * the save prompt, the autofill list — deals in usernames.
 */
export function secretFor(profileId: string, id: string): string | null {
  const blob = db.loginSecret(profileId, id)
  if (!blob) return null
  db.touchLogin(profileId, id)
  return decrypt(blob)
}

export function remove(profileId: string, id: string): SavedLogin[] {
  db.deleteLogin(profileId, id)
  return db.listLogins(profileId)
}

/** True when this pair is already stored unchanged — no point prompting again. */
export function isKnown(profileId: string, url: string, username: string, password: string): boolean {
  const origin = originOf(url)
  if (!origin) return false
  const match = db.listLogins(profileId, origin).find((l) => l.username === username)
  if (!match) return false
  return secretFor(profileId, match.id) === password
}

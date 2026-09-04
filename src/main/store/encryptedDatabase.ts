import Database from 'better-sqlite3'
import { closeSync, existsSync, fsyncSync, openSync, readSync, writeFileSync, unlinkSync } from 'node:fs'
import { createCipheriv, randomBytes } from 'node:crypto'

export function isPlaintextDatabase(path: string): boolean {
  if (!existsSync(path)) return false
  const fd = openSync(path, 'r')
  try {
    const header = Buffer.alloc(16)
    readSync(fd, header, 0, 16, 0)
    return header.toString() === 'SQLite format 3\0'
  } finally { closeSync(fd) }
}

/** fsync before a migration can replace the only durable copy of old records. */
export function durableWrite(path: string, bytes: Buffer, exclusive = false): void {
  const fd = openSync(path, exclusive ? 'wx' : 'w', 0o600)
  try { writeFileSync(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }
}

/** Native SQLite encryption also covers FTS indexes, free pages and WAL writes. */
export function openEncryptedDatabase(path: string, key: Buffer): Database.Database {
  if (key.length !== 32) throw new Error('Invalid database key.')
  const plaintext = isPlaintextDatabase(path)
  const db = new Database(path)
  try {
    const cipher = db.pragma("cipher = 'chacha20'", { simple: true })
    if (cipher !== 'chacha20') throw new Error('Encrypted SQLite is unavailable.')
    db.pragma('temp_store = MEMORY')
    db.pragma('secure_delete = ON')
    const passphrase = Buffer.from(`raw:${key.toString('hex')}`)
    if (plaintext) {
      // A recovered WAL belongs to the old plaintext database. Fold it in first.
      db.pragma('wal_checkpoint(TRUNCATE)')
      db.pragma('journal_mode = DELETE')
      if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Existing database is damaged.')
      // No plaintext backup is ever written. Keep recovery data if rekey fails.
      const snapshot = db.serialize()
      const nonce = randomBytes(12)
      const encryption = createCipheriv('aes-256-gcm', key, nonce)
      const ciphertext = Buffer.concat([encryption.update(snapshot), encryption.final()])
      snapshot.fill(0)
      const recovery = `${path}.migration.enc`
      if (existsSync(recovery)) throw new Error('An interrupted encryption migration needs recovery before starting.')
      durableWrite(recovery, Buffer.concat([Buffer.from('VOYDB1'), nonce, encryption.getAuthTag(), ciphertext]), true)
      ;(db as Database.Database & { rekey(key: Buffer): number }).rekey(passphrase)
      if (db.pragma('quick_check', { simple: true }) !== 'ok' || isPlaintextDatabase(path)) {
        throw new Error('Database encryption verification failed. Encrypted recovery data was preserved.')
      }
      // Close/reopen validates durability, not just the current connection's cache.
      db.close()
      const reopened = openEncryptedDatabase(path, key)
      unlinkSync(recovery)
      passphrase.fill(0)
      return reopened
    }
    ;(db as Database.Database & { key(key: Buffer): number }).key(passphrase)
    passphrase.fill(0)
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Encrypted database is damaged or locked.')
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = FULL')
    db.pragma('foreign_keys = ON')
    return db
  } catch (error) {
    if (db.open) db.close()
    throw error
  }
}

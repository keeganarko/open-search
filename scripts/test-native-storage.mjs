import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes, createDecipheriv } from 'node:crypto'
import assert from 'node:assert/strict'

await build({ entryPoints: ['src/main/store/encryptedDatabase.ts'], bundle: true, platform: 'node',
  format: 'cjs', external: ['better-sqlite3'], outfile: 'out/security-tests/storage.cjs' })
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { openEncryptedDatabase } = require(resolve('out/security-tests/storage.cjs'))
const directory = mkdtempSync(join(tmpdir(), 'voyager-storage-test-'))
const key = randomBytes(32)
const needle = 'VOYAGER_TEST_SENSITIVE_RECORD_7a3a'
let passed = 0
try {
  const path = join(directory, 'new.db')
  let db = openEncryptedDatabase(path, key)
  db.exec('CREATE TABLE records(value TEXT); CREATE VIRTUAL TABLE search USING fts5(value)')
  db.prepare('INSERT INTO records VALUES(?)').run(needle)
  db.prepare('INSERT INTO search VALUES(?)').run(needle)
  for (const file of [path, `${path}-wal`]) {
    assert.equal(readFileSync(file).includes(Buffer.from(needle)), false, 'No plaintext in database or WAL')
  }
  db.close()
  assert.throws(() => new Database(path).prepare('SELECT * FROM records').all())
  assert.throws(() => openEncryptedDatabase(path, randomBytes(32)))
  db = openEncryptedDatabase(path, key)
  assert.equal(db.prepare('SELECT value FROM records').get().value, needle)
  assert.equal(db.prepare("SELECT value FROM search WHERE search MATCH 'VOYAGER*'").get().value, needle)
  db.close()
  passed += 5

  const legacy = join(directory, 'legacy.db')
  db = new Database(legacy)
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE records(value TEXT); CREATE VIRTUAL TABLE search USING fts5(value)')
  db.prepare('INSERT INTO records VALUES(?)').run(needle)
  db.prepare('INSERT INTO search VALUES(?)').run(needle)
  db.close()
  db = openEncryptedDatabase(legacy, key)
  assert.equal(db.prepare('SELECT value FROM records').get().value, needle)
  assert.equal(db.prepare("SELECT value FROM search WHERE search MATCH 'VOYAGER*'").get().value, needle)
  assert.equal(readFileSync(legacy).includes(Buffer.from(needle)), false)
  assert.equal(existsSync(`${legacy}.migration.enc`), false)
  db.close()
  passed += 4

  const interrupted = join(directory, 'interrupted.db')
  db = new Database(interrupted)
  db.exec('CREATE TABLE records(value TEXT)')
  db.prepare('INSERT INTO records VALUES(?)').run(needle)
  db.close()
  const originalRekey = Database.prototype.rekey
  Database.prototype.rekey = () => { throw new Error('Simulated interruption') }
  try { assert.throws(() => openEncryptedDatabase(interrupted, key), /Simulated/) }
  finally { Database.prototype.rekey = originalRekey }
  const recovery = readFileSync(`${interrupted}.migration.enc`)
  assert.equal(recovery.includes(Buffer.from(needle)), false)
  const decipher = createDecipheriv('aes-256-gcm', key, recovery.subarray(6, 18))
  decipher.setAuthTag(recovery.subarray(18, 34))
  const snapshot = Buffer.concat([decipher.update(recovery.subarray(34)), decipher.final()])
  db = new Database(snapshot)
  assert.equal(db.prepare('SELECT value FROM records').get().value, needle)
  db.close()
  snapshot.fill(0)
  assert.throws(() => openEncryptedDatabase(interrupted, key), /interrupted/)
  passed += 4

  const tampered = readFileSync(path)
  tampered[120] ^= 0xff
  writeFileSync(path, tampered)
  assert.throws(() => openEncryptedDatabase(path, key))
  passed++
  console.log(`${passed} native encrypted-storage checks passed (real SQLite; no stubs).`)
} finally { key.fill(0); rmSync(directory, { recursive: true, force: true }) }

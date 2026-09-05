// Native SQLite integration checks using synthetic records and a simulated OS
// key store. This does not validate Windows Hello or Chrome's protected vault.
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const directory = mkdtempSync(join(tmpdir(), 'voyager-import-native-'))
try {
  await build({ stdin: { contents: `export * from './src/main/store/db'; export { readChromeHistory } from './src/main/browser/chromeImport';`, resolveDir: process.cwd() },
    bundle: true, platform: 'node', format: 'cjs', tsconfig: 'tsconfig.node.json', external: ['better-sqlite3'], outfile: 'out/import-tests/native.cjs',
    plugins: [{ name: 'isolated-credentials', setup(b) {
      b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }))
      b.onResolve({ filter: /^\.\/databaseKey$/ }, () => ({ path: 'key', namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: args.path === 'key'
        ? `export const databaseKey = () => Buffer.alloc(32, 19)`
        : `import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
          export const app = { getPath: () => ${JSON.stringify(directory)} };
          export const dialog = {};
          export const safeStorage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret',
            encryptString(s) { const iv=randomBytes(12), c=createCipheriv('aes-256-gcm',Buffer.alloc(32,21),iv); const data=Buffer.concat([c.update(s,'utf8'),c.final()]); return Buffer.concat([iv,c.getAuthTag(),data]); },
            decryptString(b) { const d=createDecipheriv('aes-256-gcm',Buffer.alloc(32,21),b.subarray(0,12)); d.setAuthTag(b.subarray(12,28)); return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8'); }
          };`
      }))
    } }] })
  const store = require(resolve('out/import-tests/native.cjs'))
  store.openDb()
  const profile = store.ensureDefaultProfile()
  const other = store.createProfile('Other test profile', '#6366f1', '')
  const now = new Date().toISOString()
  const sourcePath = join(directory, 'History')
  const source = new Database(sourcePath)
  source.pragma('journal_mode = WAL')
  source.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY,url TEXT,title TEXT,last_visit_time INTEGER,hidden INTEGER)')
  const chromeStamp = (BigInt(Date.parse(now)) + 11644473600000n) * 1000n
  source.prepare('INSERT INTO urls VALUES(1,?,?,?,0)').run('https://example.com/research', 'Synthetic research', chromeStamp)
  source.prepare('INSERT INTO urls VALUES(2,?,?,?,0)').run('javascript:alert(1)', 'Unsupported', chromeStamp)
  source.prepare('INSERT INTO urls VALUES(3,?,?,?,1)').run('https://hidden.example/', 'Hidden', chromeStamp)
  const read = store.readChromeHistory(sourcePath)
  assert.equal(read.rows.length, 1, 'Reads current WAL records without closing Chrome')
  assert.equal(read.skipped, 1)
  assert.equal(read.rows[0].visitedAt, now)
  source.close()
  const before = readFileSync(sourcePath)
  store.readChromeHistory(sourcePath)
  assert.deepEqual(readFileSync(sourcePath), before, 'Leaves source History unchanged')

  const data = { bookmarks: [
    { url: 'https://example.com/research', title: 'Synthetic research', folder: 'Chrome / Research', createdAt: now },
    { url: 'https://example.com/research', title: 'Duplicate', folder: null, createdAt: now }
  ], history: read.rows, passwords: [
    { origin: 'https://example.com', username: 'synthetic-user', password: 'IMPORT_TEST_SECRET_8349' }
  ], skipped: read.skipped }
  const expected = { bookmarks: 1, history: 1, passwords: 1, duplicates: 1, skipped: 1 }
  assert.deepEqual(store.importBrowserRecords(profile.id, data, true), expected)
  assert.equal(store.listBookmarks(profile.id).length, 0, 'Preview does not write')
  assert.deepEqual(store.importBrowserRecords(profile.id, data), expected)
  assert.equal(store.searchHistory(profile.id, 'research').length, 1, 'Imported history is in FTS')
  assert.equal(store.searchBookmarks(profile.id, 'Chrome Research').length, 1, 'Folders are searchable')
  assert.equal(store.listLogins(profile.id).length, 1)
  assert.equal(store.listBookmarks(other.id).length, 0, 'Destination isolation')
  assert.deepEqual(store.importBrowserRecords(profile.id, data), { bookmarks: 0, history: 0, passwords: 0, duplicates: 4, skipped: 1 })
  assert.deepEqual(store.importBrowserRecords(other.id, data), expected, 'Dedupe is profile scoped')
  const replacement = { ...data, bookmarks: [], history: [], passwords: [{ ...data.passwords[0], password: 'DO_NOT_OVERWRITE' }] }
  store.importBrowserRecords(profile.id, replacement)
  const login = store.listLogins(profile.id)[0]
  const secretBlob = Buffer.from(store.loginSecret(profile.id, login.id), 'base64')
  assert.equal(secretBlob.includes(Buffer.from('IMPORT_TEST_SECRET_8349')), false, 'Password is separately encrypted')
  const { createDecipheriv } = await import('node:crypto')
  const decipher = createDecipheriv('aes-256-gcm', Buffer.alloc(32, 21), secretBlob.subarray(0, 12))
  decipher.setAuthTag(secretBlob.subarray(12, 28))
  assert.equal(Buffer.concat([decipher.update(secretBlob.subarray(28)), decipher.final()]).toString(), 'IMPORT_TEST_SECRET_8349', 'Existing password preserved')
  assert.throws(() => store.importBrowserRecords(profile.id, { ...data, passwords: [], history: [], bookmarks: [
    { ...data.bookmarks[0], url: 'https://rollback.example/one' },
    { ...data.bookmarks[0], url: 'https://rollback.example/two', title: null }
  ] }))
  assert.equal(store.searchBookmarks(profile.id, 'rollback').length, 0, 'Failed batch rolls back completely')
  store.closeDb()
  const encrypted = readFileSync(join(directory, 'voyager.db'))
  assert.equal(encrypted.includes(Buffer.from('Synthetic research')), false)
  assert.equal(encrypted.includes(Buffer.from('IMPORT_TEST_SECRET_8349')), false)
  console.log('Native import checks passed: WAL, dates, preview, atomic writes, FTS, deduplication, profile isolation, credential preservation, and encrypted storage.')
} finally { rmSync(directory, { recursive: true, force: true }) }

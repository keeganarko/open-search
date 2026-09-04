import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

await build({ entryPoints: ['src/main/security/updateManifest.ts'], bundle: true, platform: 'node',
  format: 'cjs', outfile: 'out/security-tests/manifest.cjs' })
const require = createRequire(import.meta.url)
const { verifyRelease } = require(resolve('out/security-tests/manifest.cjs'))
const directory = mkdtempSync(join(tmpdir(), 'voyager-release-signing-test-'))
const script = resolve('scripts/sign-release.mjs')
try {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  mkdirSync(join(directory, 'resources/security'), { recursive: true })
  mkdirSync(join(directory, 'release'))
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: '1.2.3' }))
  writeFileSync(join(directory, 'resources/security/update-keys.json'), JSON.stringify([publicKey]))
  for (const ext of ['exe', 'zip', 'AppImage']) writeFileSync(join(directory, `release/fixture.${ext}`), 'Harmless signing fixture')
  const result = spawnSync(process.execPath, [script, 'release'], {
    cwd: directory, env: { ...process.env, VOYAGER_UPDATE_PRIVATE_KEY: privateKey }, encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)
  const raw = readFileSync(join(directory, 'release/voyager-security.json'), 'utf8')
  assert.equal(verifyRelease(raw, [publicKey]).files.length, 3)
  assert.throws(() => verifyRelease(raw.replace('1.2.3', '9.9.9'), [publicKey]))
  writeFileSync(join(directory, 'resources/security/update-keys.json'), '[]')
  const denied = spawnSync(process.execPath, [script, 'release'], {
    cwd: directory, env: { ...process.env, VOYAGER_UPDATE_PRIVATE_KEY: privateKey }, encoding: 'utf8'
  })
  assert.notEqual(denied.status, 0)
  console.log('Release signer integration: accepted trusted signatures; rejected tampering and an unpinned signing key.')
} finally { rmSync(directory, { recursive: true, force: true }) }

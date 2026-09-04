import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, cpSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'electron-builder'
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses'
import assert from 'node:assert/strict'
import { verifyArchive } from './verify-asar.mjs'

const directory = mkdtempSync(join(tmpdir(), 'voyager-test-tls-'))
const snapshot = mkdtempSync(join(tmpdir(), 'voyager-test-build-'))
try {
  const key = join(directory, 'key.pem')
  const cert = join(directory, 'cert.pem')
  const openssl = process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl'
  const made = spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
    '-out', cert, '-days', '2', '-subj', '/CN=voyager-a.test',
    '-addext', 'subjectAltName=DNS:voyager-a.test,DNS:voyager-download.test'], { stdio: 'ignore' })
  if (made.status !== 0) throw new Error('OpenSSL could not make the isolated TLS fixture.')
  const result = spawnSync(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'build'], {
    stdio: 'inherit', env: { ...process.env, VOYAGER_SECURITY_TEST: '1',
      VOYAGER_TEST_TLS: JSON.stringify({ key: readFileSync(key, 'utf8'), cert: readFileSync(cert, 'utf8') }) }
  })
  if (result.status !== 0) throw new Error('Security test build failed.')
  // Assets or source can change in another editor while packaging takes minutes.
  // Freeze all app inputs. Dependency installation is read-only during this task.
  for (const name of ['out', 'resources', 'build', 'package.json', 'package-lock.json']) {
    cpSync(name, join(snapshot, name), { recursive: true })
  }
  symlinkSync(resolve('node_modules'), join(snapshot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  await build({ projectDir: snapshot, ...(process.argv.includes('--linux') ? { linux: ['dir'] } : { win: ['dir'] }), x64: true, publish: 'never', config: {
    directories: { output: resolve('release/security-runtime') },
    win: { signExecutable: false, extraResources: [] },
    extraMetadata: { name: 'voyager-security-test', productName: 'Voyager Security Test' }
  } })
  const binary = process.argv.includes('--linux')
    ? 'release/security-runtime/linux-unpacked/voyager-security-test' : 'release/security-runtime/win-unpacked/Voyager.exe'
  verifyArchive(join(binary, '..', 'resources/app.asar'))
  const wire = await getCurrentFuseWire(binary)
  for (const [name, enabled] of Object.entries({ RunAsNode: false, EnableCookieEncryption: true,
    EnableNodeOptionsEnvironmentVariable: false, EnableNodeCliInspectArguments: false,
    EnableEmbeddedAsarIntegrityValidation: true, OnlyLoadAppFromAsar: true,
    GrantFileProtocolExtraPrivileges: false })) {
    assert.equal(wire[FuseV1Options[name]], enabled ? 49 : 48, `Unexpected ${name} fuse`)
  }
} finally {
  rmSync(directory, { recursive: true, force: true })
  rmSync(snapshot, { recursive: true, force: true })
}

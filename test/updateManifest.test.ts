import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { verifyRelease, matchUpdateFiles, newerVersion } from '../src/main/security/updateManifest'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const key = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const now = Date.now()
const release = { version: '1.2.3', publishedAt: new Date(now - 1000).toISOString(),
  expiresAt: new Date(now + 86400_000).toISOString(),
  files: [{ name: 'Voyager-1.2.3-win-x64.exe', size: 1024, sha512: Buffer.alloc(64, 1).toString('base64') }] }
function signed(value: unknown): string {
  const payload = JSON.stringify(value)
  return JSON.stringify({ payload, signature: sign(null, Buffer.from(payload), privateKey).toString('base64') })
}
describe('release authenticity', () => {
  it('accepts only an intact release signed by a pinned key', () => {
    expect(verifyRelease(signed(release), [key], now)).toEqual(release)
    expect(() => verifyRelease(signed(release).replace('1.2.3', '9.9.9'), [key], now)).toThrow(/signature/)
    expect(() => verifyRelease(signed(release), [], now)).toThrow(/signature/)
  })
  it('rejects stale, future and excessively long-lived manifests', () => {
    for (const changes of [
      { expiresAt: new Date(now - 1).toISOString() },
      { publishedAt: new Date(now + 3600_000).toISOString() },
      { expiresAt: new Date(now + 60 * 86400_000).toISOString() }
    ]) expect(() => verifyRelease(signed({ ...release, ...changes }), [key], now)).toThrow(/dates|expired/)
  })
  it('rejects unsigned destinations, artifact substitution and version mismatch', () => {
    const info = { version: release.version, files: release.files.map((f) => ({ ...f, url: f.name })) }
    expect(() => matchUpdateFiles(release, info)).not.toThrow()
    for (const url of ['https://attacker.example/payload.exe', '../payload.exe', 'other.exe']) {
      expect(() => matchUpdateFiles(release, { ...info, files: [{ ...info.files[0], url }] })).toThrow()
    }
    expect(() => matchUpdateFiles(release, { ...info, version: '9.9.9' })).toThrow()
    expect(() => matchUpdateFiles(release, { ...info, files: [{ ...info.files[0], sha512: 'bad' }] })).toThrow()
    expect(() => matchUpdateFiles(release, { ...info, files: [] })).toThrow()
  })
  it('refuses equal versions, downgrade and preview versions', () => {
    expect(newerVersion('1.10.0', '1.9.0')).toBe(true)
    expect(newerVersion('1.2.3', '1.2.3')).toBe(false)
    expect(newerVersion('1.2.2', '1.2.3')).toBe(false)
    expect(() => newerVersion('1.2.4-beta', '1.2.3')).toThrow()
  })
})

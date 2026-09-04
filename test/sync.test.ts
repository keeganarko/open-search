import { describe, it, expect, vi, beforeEach } from 'vitest'

const settings = vi.hoisted(() => ({ set: vi.fn() }))
vi.mock('../src/main/store/settings', () => ({
  getSettings: () => ({ ai: { apiKey: 'sk-local-machine-key' }, sync: { folder: '/local' } }),
  setSettings: settings.set,
  isExcluded: () => false
}))
vi.mock('../src/main/store/db', () => ({
  listSkills: () => [], listMemory: () => [], listBookmarks: () => [], listProfiles: () => [],
  upsertSkill: vi.fn(), addMemory: vi.fn(), addBookmark: vi.fn()
}))
vi.mock('../src/main/agent/mcp', () => ({ mcp: { configs: () => [], save: vi.fn() } }))

const files = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('node:fs/promises', () => ({
  readFile: files.read, writeFile: vi.fn(), mkdir: vi.fn()
}))

const { encryptBundle, decryptBundle, importSync } = await import('../src/main/store/sync')

const bundle = {
  version: 1 as const,
  exportedAt: '2026-09-04T00:00:00.000Z',
  settings: { ai: { apiKey: 'sk-from-the-other-machine' }, sync: { folder: '/theirs' } },
  skills: [], memory: [], bookmarks: [], mcpServers: [], profiles: []
}

describe('bundle crypto', () => {
  it('round-trips through a passphrase', () => {
    const out = decryptBundle(encryptBundle(bundle, 'correct horse'), 'correct horse')
    expect(out).toEqual(bundle)
  })

  it('rejects the wrong passphrase without saying which part failed', () => {
    const buf = encryptBundle(bundle, 'right')
    expect(() => decryptBundle(buf, 'wrong')).toThrow(/passphrase/i)
  })

  it('rejects a tampered body — the GCM tag covers it', () => {
    const buf = encryptBundle(bundle, 'p')
    buf[buf.length - 1] ^= 0xff
    expect(() => decryptBundle(buf, 'p')).toThrow(/passphrase|modified/i)
  })

  it('rejects a file that is not a bundle', () => {
    expect(() => decryptBundle(Buffer.from('hello world padding'), 'p'))
      .toThrow(/not an Open Search sync bundle/)
  })

  it('rejects a file too short to hold the header', () => {
    // timingSafeEqual throws on a length mismatch, so this must be caught first.
    expect(() => decryptBundle(Buffer.from('KIA'), 'p'))
      .toThrow(/not an Open Search sync bundle/)
  })

  it('uses a fresh salt and iv, so two exports never match', () => {
    expect(encryptBundle(bundle, 'p').equals(encryptBundle(bundle, 'p'))).toBe(false)
  })
})

describe('importSync', () => {
  beforeEach(() => settings.set.mockClear())

  it('never lets a bundle overwrite the local key or sync target', async () => {
    files.read.mockResolvedValue(encryptBundle(bundle, 'p'))
    await importSync('profile-1', '/somewhere/kia-sync.enc', 'p')

    expect(settings.set).toHaveBeenCalledTimes(1)
    const applied = settings.set.mock.calls[0][0]
    expect(applied.ai).not.toHaveProperty('apiKey')
    expect(applied).not.toHaveProperty('sync')
  })

  it('refuses a bundle it cannot decrypt rather than importing nothing quietly', async () => {
    files.read.mockResolvedValue(encryptBundle(bundle, 'p'))
    await expect(importSync('profile-1', '/x.enc', 'nope')).rejects.toThrow()
    expect(settings.set).not.toHaveBeenCalled()
  })
})

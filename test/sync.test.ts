import { describe, it, expect, vi, beforeEach } from 'vitest'

const settings = vi.hoisted(() => ({ set: vi.fn() }))
const connectors = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('../src/main/store/settings', () => ({
  getSettings: () => ({ ai: { apiKey: 'sk-local-machine-key' }, sync: { folder: '/local' } }),
  setSettings: settings.set,
  isExcluded: () => false
}))
vi.mock('../src/main/store/db', () => ({
  listSkills: () => [], listMemory: () => [], listBookmarks: () => [], listProfiles: () => [],
  upsertSkill: vi.fn(), addMemory: vi.fn(), addBookmark: vi.fn()
}))
vi.mock('../src/main/agent/mcp', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/agent/mcp')>(),
  mcp: { configs: () => [], save: connectors.save }
}))

const files = vi.hoisted(() => ({ read: vi.fn(), stat: vi.fn(() => ({ size: 1_024 })) }))
vi.mock('node:fs/promises', () => ({
  readFile: files.read, writeFile: vi.fn(), mkdir: vi.fn(), stat: files.stat
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
      .toThrow(/not a Voyager sync bundle/)
  })

  it('rejects a file too short to hold the header', () => {
    // timingSafeEqual throws on a length mismatch, so this must be caught first.
    expect(() => decryptBundle(Buffer.from('BAD'), 'p'))
      .toThrow(/not a Voyager sync bundle/)
  })

  it('uses a fresh salt and iv, so two exports never match', () => {
    expect(encryptBundle(bundle, 'p').equals(encryptBundle(bundle, 'p'))).toBe(false)
  })
})

describe('importSync', () => {
  beforeEach(() => { settings.set.mockClear(); connectors.save.mockClear() })

  it('never lets a bundle overwrite the local key or sync target', async () => {
    files.read.mockResolvedValue(encryptBundle(bundle, 'p'))
    await importSync('profile-1', '/somewhere/voyager-sync.enc', 'p')

    expect(settings.set).toHaveBeenCalledTimes(1)
    const applied = settings.set.mock.calls[0][0]
    expect(applied).not.toHaveProperty('ai')
    expect(applied).not.toHaveProperty('sync')
  })

  it('refuses a bundle it cannot decrypt rather than importing nothing quietly', async () => {
    files.read.mockResolvedValue(encryptBundle(bundle, 'p'))
    await expect(importSync('profile-1', '/x.enc', 'nope')).rejects.toThrow()
    expect(settings.set).not.toHaveBeenCalled()
  })

  it('restores local connectors disabled so importing data cannot launch a command', async () => {
    files.read.mockResolvedValue(encryptBundle({
      ...bundle,
      mcpServers: [{
        id: 'local', name: 'Local tool', enabled: true,
        transport: 'stdio', command: 'trusted-after-review', args: [], env: {}
      }]
    }, 'p'))
    await importSync('profile-1', '/somewhere/voyager-sync.enc', 'p')
    expect(connectors.save).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
  })
})


describe('sync trust boundaries', () => {
  beforeEach(() => { settings.set.mockClear(); connectors.save.mockClear() })
  it('cannot import looser consent, exclusions, approval, or background policies', async () => {
    files.read.mockResolvedValue(encryptBundle({ ...bundle, settings: {
      ai: { contextConsent: true }, privacy: { excludedDomains: [] },
      approvals: { auto: ['external_write'] }, brief: { enabled: true }, appearance: { theme: 'dark' }
    } }, 'p'))
    await importSync('p', '/x', 'p')
    expect(settings.set.mock.calls[0][0]).toEqual({ appearance: { theme: 'dark' }, search: undefined })
  })
  it('validates all data before changing settings or saving any connector', async () => {
    files.read.mockResolvedValue(encryptBundle({ ...bundle, memory: [{ kind: 'fact', text: { bad: true } }] }, 'p'))
    await expect(importSync('p', '/x', 'p')).rejects.toThrow()
    expect(settings.set).not.toHaveBeenCalled()
    expect(connectors.save).not.toHaveBeenCalled()
  })
  it('strips connector credentials from older bundles too', async () => {
    files.read.mockResolvedValue(encryptBundle({ ...bundle, mcpServers: [{
      id: 'x', name: 'Local', transport: 'stdio', command: 'program', args: [], enabled: true,
      env: { SECRET: 'test' }, headers: { Authorization: 'test' }
    }] }, 'p'))
    await importSync('p', '/x', 'p')
    expect(connectors.save).toHaveBeenCalledWith(expect.objectContaining({ env: {}, headers: {}, enabled: false }))
  })
})

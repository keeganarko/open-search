import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({ dialog: vi.fn(), store: vi.fn(), paused: false, excluded: false }))
vi.mock('electron', () => ({ app: { getPath: () => '/nonexistent' }, dialog: { showOpenDialog: mocks.dialog } }))
vi.mock('../src/main/store/db', () => ({ importBrowserRecords: mocks.store }))
vi.mock('../src/main/store/settings', () => ({
  getSettings: () => ({ privacy: { paused: mocks.paused, historyRetentionDays: 90 } }),
  isExcluded: (url: string) => mocks.excluded || url.includes('private.example')
}))
import { applyImportPrivacy, chromeRoots, previewImportFile, commitChromeImport, cancelChromeImport, previewChromeProfile, listChromeProfiles } from '../src/main/browser/chromeImport'

describe('import boundaries', () => {
  const win = (): any => ({ profile: { id: 'work' }, tabs: {}, window: { isDestroyed: () => false } })
  beforeEach(() => {
    mocks.paused = false; mocks.excluded = false; mocks.dialog.mockReset(); mocks.store.mockReset()
    mocks.store.mockImplementation((_id, data) => ({ bookmarks: data.bookmarks.length, history: data.history.length,
      passwords: data.passwords.length, duplicates: 0, skipped: data.skipped }))
  })
  it('discovers only standard Chrome locations, respecting Linux and Windows overrides', () => {
    expect(chromeRoots('linux', '/home/user', { XDG_CONFIG_HOME: '/config' })).toEqual(['/config/google-chrome'])
    expect(chromeRoots('darwin', '/Users/user', {})).toEqual(['/Users/user/Library/Application Support/Google/Chrome'])
    expect(chromeRoots('win32', '/home/user', { LOCALAPPDATA: '/local' })).toEqual(['/local/Google/Chrome/User Data'])
  })
  it('filters excluded and expired history and refuses to record while paused', () => {
    const now = new Date().toISOString()
    const data = { bookmarks: [], passwords: [], skipped: 0, history: [
      { url: 'https://private.example', title: 'Private', visitedAt: now },
      { url: 'https://public.example', title: 'Old', visitedAt: '2000-01-01' },
      { url: 'https://public.example', title: 'Recent', visitedAt: now }
    ] }
    expect(applyImportPrivacy(data)).toMatchObject({ skipped: 2, history: [data.history[2]] })
    mocks.paused = true
    expect(() => applyImportPrivacy(data)).toThrow(/paused/)
    expect(applyImportPrivacy({ ...data, history: [] }).bookmarks).toEqual([])
  })
  it('never accepts arbitrary source paths from the renderer', async () => {
    await expect(previewChromeProfile(win(), { profileId: '/etc/passwd', bookmarks: true, history: false })).rejects.toThrow(/detected/)
    expect(mocks.store).not.toHaveBeenCalled()
  })
  it('discovers Google-account-only bookmarks and reads both account and local stores', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'voyager-google-import-'))
    const data = (title: string) => JSON.stringify({ roots: { bookmark_bar: { name: 'Bookmarks bar', children: [
      { type: 'url', name: title, url: `https://example.com/${title}` }
    ] } } })
    try {
      const profileDir = join(dir, 'Default')
      await mkdir(profileDir)
      await writeFile(join(profileDir, 'AccountBookmarks'), data('Google'))
      mocks.dialog.mockResolvedValue({ canceled: false, filePaths: [dir] })
      const w = win()
      const profiles = await listChromeProfiles(w, true)
      expect(profiles).toHaveLength(1)
      expect(profiles![0]).toMatchObject({ bookmarks: true, history: false })
      const preview = await previewChromeProfile(w, { profileId: profiles![0].id, bookmarks: true, history: false })
      expect(preview.counts.bookmarks).toBe(1)
      expect(preview.warnings).toContain('Includes Google account bookmarks saved in this Chrome profile on this computer.')
      await writeFile(join(profileDir, 'Bookmarks'), data('Local'))
      const both = await previewChromeProfile(w, { profileId: profiles![0].id, bookmarks: true, history: false })
      expect(both.counts.bookmarks).toBe(2)
      expect(mocks.store.mock.calls.at(-1)![1].bookmarks.map((b: any) => b.title)).toEqual(['Local', 'Google'])
      // Choosing the profile directory directly also works without a local store.
      await rm(join(profileDir, 'Bookmarks'))
      mocks.dialog.mockResolvedValue({ canceled: false, filePaths: [profileDir] })
      expect((await listChromeProfiles(w, true))![0].bookmarks).toBe(true)
      cancelChromeImport(w)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it.each(['EncryptedAccountBookmarks2', 'EncryptedBookmarks2', 'EncryptedAccountBookmarks', 'EncryptedBookmarks'])('recognizes %s and directs the user to an HTML export', async (filename) => {
    const dir = await mkdtemp(join(tmpdir(), 'voyager-encrypted-bookmarks-'))
    try {
      await writeFile(join(dir, filename), 'opaque fixture')
      mocks.dialog.mockResolvedValue({ canceled: false, filePaths: [dir] })
      const w = win()
      const profiles = await listChromeProfiles(w, true)
      expect(profiles![0]).toMatchObject({ bookmarks: false, bookmarksEncrypted: true })
      await expect(previewChromeProfile(w, { profileId: profiles![0].id, bookmarks: true, history: false })).rejects.toThrow(/Export bookmarks as HTML/)
      expect(mocks.store).not.toHaveBeenCalled()
      cancelChromeImport(w)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('keeps passwords out of preview responses and binds a single-use commit to the window/profile', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'voyager-import-test-'))
    try {
      const file = join(dir, 'export.csv')
      await writeFile(file, 'url,username,password\nhttps://example.com,user,synthetic-secret\n')
      mocks.dialog.mockResolvedValue({ canceled: false, filePaths: [file] })
      const w = win()
      const preview = await previewImportFile(w, 'passwords')
      expect(JSON.stringify(preview)).not.toContain('synthetic-secret')
      expect(mocks.store.mock.calls[0][2]).toBe(true)
      expect(() => commitChromeImport(win(), preview!.id)).toThrow(/expired/)
      expect(commitChromeImport(w, preview!.id).passwords).toBe(1)
      expect(() => commitChromeImport(w, preview!.id)).toThrow(/expired/)
      const next = await previewImportFile(w, 'passwords')
      w.profile.id = 'personal'
      expect(() => commitChromeImport(w, next!.id)).toThrow(/profile changed/)
      expect(mocks.store.mock.calls.filter((c) => c[2] !== true)).toHaveLength(1)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('invalidates a file picker in flight when the user cancels or switches profiles', async () => {
    let answer!: (value: any) => void
    mocks.dialog.mockReturnValue(new Promise((resolve) => { answer = resolve }))
    const w = win()
    const started = previewImportFile(w, 'bookmarks')
    cancelChromeImport(w)
    answer({ canceled: true, filePaths: [] })
    await expect(started).rejects.toThrow(/cancelled/)
    expect(mocks.store).not.toHaveBeenCalled()
  })
})

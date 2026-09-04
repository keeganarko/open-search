import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ paused: false, url: 'https://public.example/', call: vi.fn() }))
vi.mock('../src/main/store/settings', () => ({
  getSettings: () => ({ privacy: { paused: state.paused } }),
  isExcluded: (url: string) => url.includes('private')
}))
vi.mock('../src/main/browser/pageBridge', () => ({ callPage: state.call }))
vi.mock('../src/main/store/db', () => ({
  historySince: () => [{ title: 'secret', url: 'https://private.example/', visitedAt: '' }]
}))
import { readTab, readSelection, renderTabList, resolveAttachments } from '../src/main/agent/context'

const tab: any = { id: 't', state: { title: 'public', url: 'https://public.example/' },
  view: { webContents: { getURL: () => state.url, isDestroyed: () => false } } }
const win: any = { profile: { id: 'p' }, tabs: { get: () => tab, active: () => tab, groups: [],
  list: () => [{ id: 't', title: 'secret', url: 'https://private.example/' }] } }

describe('context privacy', () => {
  beforeEach(() => { state.paused = false; state.url = 'https://public.example/'; state.call.mockReset() })
  it('does not read selections while paused', async () => {
    state.paused = true
    expect(await readSelection(win)).toBe('')
    expect(state.call).not.toHaveBeenCalled()
  })
  it('uses the live URL rather than the optimistic address-bar URL', async () => {
    state.url = 'https://private.example/'
    expect((await readTab(win, 't'))?.excluded).toBe(true)
    expect(state.call).not.toHaveBeenCalled()
  })
  it('drops text if pause is enabled during extraction', async () => {
    state.call.mockImplementation(async () => {
      state.paused = true
      return { url: state.url, text: 'secret' }
    })
    expect(await readTab(win, 't')).toBeNull()
  })
  it('does not disclose excluded tab titles or old excluded history', async () => {
    expect(renderTabList(win)).not.toContain('secret')
    const result = await resolveAttachments(win, [{ type: 'history', id: 'h', label: '', detail: '' }])
    expect(result.blocks.join('')).not.toContain('secret')
  })
})

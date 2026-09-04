import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/main/browser/pageBridge', () => ({ callPage: mock.call }))
vi.mock('../src/main/store/settings', () => ({
  getSettings: () => ({ privacy: { paused: false } }), isExcluded: () => false
}))
import { beginWriting, applyWriting } from '../src/main/browser/writing'

function fixture() {
  let url = 'https://editor.example/'
  const wc = Object.assign(new EventEmitter(), { getURL: () => url, isDestroyed: () => false })
  const tab = { id: 't', view: { webContents: wc } }
  const win: any = { profile: { id: 'p' }, window: { isDestroyed: () => false },
    tabs: { activeId: 't', get: () => tab } }
  return { win, wc, navigate: (next: string) => {
    url = next; wc.emit('did-start-navigation', { isMainFrame: true })
  } }
}

describe('reviewed rewrite destination', () => {
  beforeEach(() => mock.call.mockReset().mockResolvedValue(true))
  it('applies a reviewed result once to the original document', async () => {
    const f = fixture()
    beginWriting(f.win).finish('approved text')
    expect(await applyWriting(f.win, 'approved text', true)).toBe(true)
    expect(await applyWriting(f.win, 'approved text', true)).toBe(false)
    expect(mock.call).toHaveBeenCalledTimes(1)
    expect(f.wc.listenerCount('did-start-navigation')).toBe(0)
  })
  it('invalidates a result even if navigation returns to the same URL', async () => {
    const f = fixture()
    beginWriting(f.win).finish('approved text')
    f.navigate('https://attacker.example/')
    f.navigate('https://editor.example/')
    expect(await applyWriting(f.win, 'approved text', true)).toBe(false)
    expect(mock.call).not.toHaveBeenCalled()
  })
  it('does not apply a result after a profile switch', async () => {
    const f = fixture()
    beginWriting(f.win).finish('approved text')
    f.win.profile.id = 'other'
    expect(await applyWriting(f.win, 'approved text', true)).toBe(false)
    expect(mock.call).not.toHaveBeenCalled()
  })
  it('cannot substitute text that was not part of the review', async () => {
    const f = fixture()
    beginWriting(f.win).finish('approved text')
    expect(await applyWriting(f.win, 'different text', true)).toBe(false)
    expect(mock.call).not.toHaveBeenCalled()
  })
  it('discards an AI result when the original document has already gone', () => {
    const f = fixture()
    const draft = beginWriting(f.win)
    f.navigate('https://attacker.example/')
    expect(() => draft.finish('secret')).toThrow(/page changed/)
  })
})

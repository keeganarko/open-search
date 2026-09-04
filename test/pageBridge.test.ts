import { EventEmitter } from 'node:events'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { callPage } from '../src/main/browser/pageBridge'

describe('isolated page calls', () => {
  function fixture() {
    let url = 'https://public.example/'
    const extract = vi.fn(() => 'private text')
    const wc = Object.assign(new EventEmitter(), {
      isDestroyed: () => false, getURL: () => url,
      executeJavaScriptInIsolatedWorld: vi.fn(async (_world, scripts) =>
        vm.runInNewContext(scripts[0].code, { location: { href: url }, __voyagerPage: { extract } }))
    })
    return { wc, extract, navigate: (next: string) => {
      url = next; wc.emit('did-start-navigation', { isMainFrame: true })
    } }
  }

  it('checks the destination in the isolated world before touching the page', async () => {
    const f = fixture()
    const original = f.wc.executeJavaScriptInIsolatedWorld.getMockImplementation()!
    f.wc.executeJavaScriptInIsolatedWorld.mockImplementation(async (...args) => {
      f.navigate('https://bank.example/')
      return original(...args)
    })
    expect(await callPage(f.wc as any, 'extract')).toBeNull()
    expect(f.extract).not.toHaveBeenCalled()
    expect(f.wc.listenerCount('did-start-navigation')).toBe(0)
  })

  it('discards an in-flight result even if navigation returns to the original URL', async () => {
    const f = fixture()
    f.wc.executeJavaScriptInIsolatedWorld.mockImplementation(async () => {
      f.navigate('https://private.example/')
      f.navigate('https://public.example/')
      return 'private text'
    })
    expect(await callPage(f.wc as any, 'extract')).toBeNull()
  })

  it('returns stable results without fabricating a user gesture', async () => {
    const f = fixture()
    expect(await callPage(f.wc as any, 'extract')).toBe('private text')
    expect(f.wc.executeJavaScriptInIsolatedWorld.mock.calls[0][2]).toBe(false)
    expect(f.wc.listenerCount('did-start-navigation')).toBe(0)
  })
})

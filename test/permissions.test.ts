import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => ({ decision: vi.fn() }))
vi.mock('../src/main/store/db', () => ({
  permissionDecision: store.decision,
  recordPermission: vi.fn(),
  listPermissions: () => [],
  revokePermission: vi.fn(),
  clearPermissions: vi.fn()
}))

const perms = await import('../src/main/browser/permissions')
const { originOf, AUTO_GRANTED, decide, setWindowResolver } = perms

/** Just enough of a WebContents for `decide` — it only ever asks for the URL. */
const fakeWc = (url: string): any => ({ getURL: () => url, once: vi.fn(), id: 1 })
const fakeWin: any = { profile: { id: 'p1' }, showOverlay: vi.fn(), overlayMode: { kind: 'closed' } }
const never = (): boolean => false

describe('originOf', () => {
  it('reduces a URL to scheme + host + port', () => {
    expect(originOf('https://meet.google.com/abc?x=1#y')).toBe('https://meet.google.com')
    expect(originOf('http://localhost:5173/a')).toBe('http://localhost:5173')
  })

  it('refuses anything that is not http(s) — there is no site to name', () => {
    for (const u of ['file:///etc/passwd', 'about:blank', 'data:text/html,x', 'chrome://settings', ''])
      expect(originOf(u), u).toBeNull()
  })
})

describe('decide', () => {
  beforeEach(() => {
    store.decision.mockReset().mockReturnValue(null)
    setWindowResolver(() => fakeWin)
    fakeWin.showOverlay.mockClear()
  })

  it('grants the handful that carry no privacy cost', async () => {
    for (const p of AUTO_GRANTED) {
      expect(await decide(null, p, undefined, never), p).toBe(true)
    }
  })

  it('denies a permission it has never heard of, without asking', async () => {
    // A Chromium release can add one at any time; unknown is not a reason to grant.
    expect(await decide(fakeWc('https://example.com'), 'brand-new-capability', undefined, never)).toBe(false)
    expect(fakeWin.showOverlay).not.toHaveBeenCalled()
  })

  it('denies an excluded site before it can ever prompt', async () => {
    const excluded = (): boolean => true
    expect(await decide(fakeWc('https://chase.com'), 'media', ['audio'], excluded)).toBe(false)
    expect(fakeWin.showOverlay).not.toHaveBeenCalled()
  })

  it('evaluates the requesting frame origin instead of inheriting the top page', async () => {
    store.decision.mockReturnValue(null)
    const excluded = (url: string): boolean => url.includes('embedded.example')
    expect(await decide(
      fakeWc('https://trusted.example'), 'geolocation', undefined, excluded,
      'https://embedded.example/frame'
    )).toBe(false)
    expect(fakeWin.showOverlay).not.toHaveBeenCalled()
  })

  it('denies a page with no origin to remember a decision against', async () => {
    expect(await decide(fakeWc('file:///Users/x/page.html'), 'geolocation', undefined, never)).toBe(false)
  })

  it('denies when no window owns the request, rather than prompting nowhere', async () => {
    setWindowResolver(() => null)
    expect(await decide(fakeWc('https://example.com'), 'notifications', undefined, never)).toBe(false)
  })

  it('honours a stored allow without prompting again', async () => {
    store.decision.mockReturnValue(true)
    expect(await decide(fakeWc('https://meet.google.com'), 'media', ['video'], never)).toBe(true)
    expect(fakeWin.showOverlay).not.toHaveBeenCalled()
  })

  it('honours a stored deny without prompting again', async () => {
    store.decision.mockReturnValue(false)
    expect(await decide(fakeWc('https://ads.example'), 'notifications', undefined, never)).toBe(false)
    expect(fakeWin.showOverlay).not.toHaveBeenCalled()
  })

  it('prompts only when there is no stored answer', async () => {
    store.decision.mockReturnValue(null)
    void decide(fakeWc('https://example.com'), 'geolocation', undefined, never)
    await Promise.resolve()
    expect(fakeWin.showOverlay).toHaveBeenCalledOnce()
    expect(fakeWin.showOverlay.mock.calls[0][0].kind).toBe('permission')
  })
})

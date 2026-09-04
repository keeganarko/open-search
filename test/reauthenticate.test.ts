import { describe, it, expect, vi, afterEach } from 'vitest'
import { reauthenticate } from '../src/main/security/reauthenticate'
import { systemPreferences } from 'electron'

const mocks = vi.hoisted(() => ({ exec: vi.fn() }))
vi.mock('node:child_process', () => ({
  execFile: Object.assign(() => {}, { [Symbol.for('nodejs.util.promisify.custom')]: mocks.exec })
}))
const window = (): any => ({ isDestroyed: () => false, getNativeWindowHandle: () => Buffer.from([1, 0, 0, 0]) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); mocks.exec.mockReset() })
describe('device authentication', () => {
  it('denies reveal on platforms without an implemented authenticator', async () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' })
    expect(await reauthenticate(window())).toBe(false)
  })
  it('requires successful Touch ID, never a confirmation fallback', async () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' })
    expect(await reauthenticate(window())).toBe(false)
    vi.spyOn(systemPreferences, 'canPromptTouchID').mockReturnValue(true)
    vi.spyOn(systemPreferences, 'promptTouchID').mockRejectedValue(new Error('Cancelled'))
    expect(await reauthenticate(window())).toBe(false)
    vi.mocked(systemPreferences.promptTouchID).mockResolvedValue()
    expect(await reauthenticate(window())).toBe(true)
  })
  it('rejects missing helpers, failed verification and destroyed windows', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    mocks.exec.mockRejectedValue(new Error('Missing helper'))
    expect(await reauthenticate(window())).toBe(false)
    mocks.exec.mockResolvedValue({ stdout: 'CANCELLED' })
    expect(await reauthenticate(window())).toBe(false)
    const target = window()
    mocks.exec.mockImplementation(async () => { target.isDestroyed = () => true; return { stdout: 'VERIFIED' } })
    expect(await reauthenticate(target)).toBe(false)
    mocks.exec.mockResolvedValue({ stdout: 'VERIFIED' })
    expect(await reauthenticate(window())).toBe(true)
    expect(mocks.exec.mock.calls.at(-1)?.[1]).toEqual(['1'])
  })
})

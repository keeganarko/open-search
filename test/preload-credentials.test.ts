import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const source = ts.transpileModule(readFileSync('src/preload/page.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

function fixture(origin: string) {
  const listeners = new Map<string, Function>()
  class Input {
    disabled = false; offsetParent = {}; form = null; value = ''; type = 'text'
    dispatchEvent = vi.fn()
  }
  Object.defineProperty(Input.prototype, 'value', {
    set(this: any, value) { this.stored = value }, get(this: any) { return this.stored ?? '' }
  })
  const user = new Input()
  const pw = new Input(); pw.type = 'password'
  const document = { addEventListener: vi.fn(), querySelectorAll: vi.fn((selector: string) =>
    selector === 'input[type=password]' ? [pw] : [user, pw]) }
  const window: any = { addEventListener: vi.fn() }; window.top = window
  vm.runInNewContext(source, {
    exports: {}, require: (name: string) => name === 'electron'
      ? { ipcRenderer: { on: (channel: string, handler: Function) => listeners.set(channel, handler) } }
      : {},
    window, document, location: { origin }, HTMLInputElement: Input, Event: class {}
  })
  return { document, user, pw, fill: listeners.get('voyager:login-fill')! }
}

describe('credential delivery after navigation', () => {
  it('rejects a queued fill when the receiving document has a different origin', () => {
    const f = fixture('https://attacker.example')
    f.fill({}, { origin: 'https://account.example', username: 'user', password: 'secret' })
    expect(f.document.querySelectorAll).not.toHaveBeenCalled()
    expect(f.pw.dispatchEvent).not.toHaveBeenCalled()
  })
  it('fills the original origin and notifies the page after setting both fields', () => {
    const f = fixture('https://account.example')
    f.fill({}, { origin: 'https://account.example', username: 'user', password: 'secret' })
    expect((f.user as any).stored).toBe('user')
    expect((f.pw as any).stored).toBe('secret')
    expect(f.pw.dispatchEvent).toHaveBeenCalledTimes(2)
  })
})

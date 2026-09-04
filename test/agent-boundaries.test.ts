import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ create: vi.fn(), call: vi.fn(), local: vi.fn(), binding: {} }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: mocks.create } } }))
vi.mock('../src/main/store/settings', () => ({
  getSettings: () => ({ ai: { apiKey: 'test', model: 'test', effort: 'low' },
    approvals: { auto: ['read', 'local_reversible', 'external_write'] } })
}))
vi.mock('../src/main/agent/tools', () => ({
  browserTools: () => [{ definition: { name: 'list_tabs' }, actionClass: 'read', run: mocks.local }],
  serverTools: () => []
}))
vi.mock('../src/main/agent/mcp', () => ({ mcp: {
  anthropicTools: () => [{ name: 'connector__get', actionClass: 'read' }],
  isMcpTool: (name: string) => name.startsWith('connector__'),
  actionClassOf: () => 'read', call: mocks.call, bindingOf: () => mocks.binding
} }))
import { oneShot } from '../src/main/agent/oneshot'
import { AgentEngine } from '../src/main/agent/engine'

function win(): any { return { profile: { id: 'p' }, tabs: {}, window: { isDestroyed: () => false } } }
describe('agent execution boundaries', () => {
  beforeEach(() => { mocks.create.mockReset(); mocks.call.mockReset(); mocks.local.mockReset(); mocks.binding = {} })
  it('refuses a model-invented connector call in background work', async () => {
    mocks.create.mockResolvedValueOnce({ content: [{ type: 'tool_use', id: 'x', name: 'connector__delete', input: {} }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'done' }] })
    await oneShot(win(), 'brief', { system: '', useConnectors: true })
    expect(mocks.call).not.toHaveBeenCalled()
    expect(mocks.create.mock.calls[0][0].tools.map((t: any) => t.name)).toEqual(['list_tabs'])
  })
  it('stops background tool execution after a profile switch', async () => {
    const w = win()
    mocks.create.mockImplementation(async () => {
      w.profile.id = 'other'
      return { content: [{ type: 'tool_use', id: 'x', name: 'list_tabs', input: {} }] }
    })
    await expect(oneShot(w, 'brief')).rejects.toThrow(/cancelled/)
    expect(mocks.local).not.toHaveBeenCalled()
  })

  function pending(name = 'connector__get') {
    const engine: any = new AgentEngine()
    const w = win()
    const emit = vi.fn()
    engine.aborts.set('msg', { controller: new AbortController(), win: w })
    const promise = engine.runTool(w, { id: 'use', name, input: { query: 'private text' } },
      new Map(), { steps: [] }, 'msg', emit)
    return { engine, w, emit, promise }
  }
  it('requires approval even for a connector that calls itself read-only', async () => {
    const p = pending()
    expect(p.emit.mock.calls[0][0].type).toBe('approval')
    expect(mocks.call).not.toHaveBeenCalled()
    p.engine.respondToApproval(win(), 'msg:use', true)
    expect(mocks.call).not.toHaveBeenCalled()
    p.engine.respondToApproval(p.w, 'msg:use', false)
    expect((await p.promise).content).toMatch(/declined/)
    expect(mocks.call).not.toHaveBeenCalled()
  })
  it('does not call a replaced connector after approval', async () => {
    const p = pending()
    mocks.binding = {}
    p.engine.respondToApproval(p.w, 'msg:use', true)
    expect((await p.promise).content).toMatch(/connector changed/)
    expect(mocks.call).not.toHaveBeenCalled()
  })
  it('does not execute an approved call after Stop', async () => {
    const p = pending()
    p.engine.respondToApproval(p.w, 'msg:use', true)
    p.engine.stop('msg', p.w)
    expect((await p.promise).content).toMatch(/stopped/)
    expect(mocks.call).not.toHaveBeenCalled()
  })
})

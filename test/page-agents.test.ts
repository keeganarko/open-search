import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { AgentStart } from '../src/shared/agents'

const mocks = vi.hoisted(() => ({ kv: new Map<string, unknown>(), paused: false, page: vi.fn(), connector: vi.fn(), connectorBinding: {} }))
vi.mock('../src/main/store/db', () => ({
  kvGet: (key: string, fallback: unknown) => structuredClone(mocks.kv.get(key) ?? fallback),
  kvSet: (key: string, value: unknown) => mocks.kv.set(key, structuredClone(value))
}))
vi.mock('../src/main/store/settings', () => ({ getSettings: () => ({ privacy: { paused: mocks.paused }, ai: { apiKey: 'fixture-key', model: 'fixture-model' } }), isExcluded: (s: string) => s.includes('excluded.example') }))
vi.mock('../src/main/browser/window', () => ({ post: vi.fn() }))
vi.mock('../src/main/browser/pageBridge', () => ({ callPage: (...args: unknown[]) => mocks.page(...args) }))
vi.mock('../src/main/agent/mcp', () => ({ mcp: {
  anthropicTools: () => [{ name: 'fixture_connector', description: 'Fixture connector', input_schema: { type: 'object' } }],
  isMcpTool: (name: string, profile: string) => name === 'fixture_connector' && profile === 'profile-a',
  bindingOf: () => mocks.connectorBinding, call: (...args: unknown[]) => mocks.connector(...args)
} }))
import { PageAgentRuntime, type AgentModel } from '../src/main/agent/agentRuntime'
import { parseDefinition, parseStart, agentOrigin, sourceUrl, redact } from '../src/main/agent/agentPolicy'
import { AGENT_PRESETS } from '../src/shared/agents'
import { saveAgentDefinition, agentDefinitions, agentHistory } from '../src/main/agent/agentStore'

let wcId = 0
function windowFixture(profileId = 'profile-a', key = 'window-a') {
  const makeTab = (id: string, title: string) => {
    const wc = Object.assign(new EventEmitter(), { id: ++wcId, url: `https://${id}.example/page`, isDestroyed: () => false,
      isLoadingMainFrame: () => false, getTitle: () => title, getURL() { return this.url }, loadURL: vi.fn(async (url: string) => { wc.url = url }) })
    return { id, state: { title }, view: { webContents: wc } }
  }
  const tabs = new Map([['one', makeTab('one', 'Allowed page')], ['two', makeTab('two', 'PRIVATE UNSELECTED TAB')]])
  return Object.assign(new EventEmitter(), { profile: { id: profileId }, key,
    window: Object.assign(new EventEmitter(), { isDestroyed: () => false }), chrome: { webContents: {} },
    tabs: { get: (id: string) => tabs.get(id) }, setSplit: vi.fn(), fixtureTabs: tabs }) as any
}
const input = (definitionId = 'research', changes: Partial<AgentStart> = {}): AgentStart => ({ definitionId, task: 'Compare facts', tabIds: ['one'], connectorTools: [], parameters: {}, intervalSeconds: 15, ...changes })
const reply = (content: any[]) => ({ content, inputTokens: 100, outputTokens: 30 })
const answer = (text = 'Finished with the observed facts.') => reply([{ type: 'text', text }])
const call = (name: string, args: unknown) => reply([{ type: 'tool_use', id: `${name}-id`, name, input: args }])
const runtimes: PageAgentRuntime[] = []
const runtime = (generate: AgentModel) => { const r = new PageAgentRuntime(generate); runtimes.push(r); return r }
const terminal = async (r: PageAgentRuntime, w: any) => vi.waitFor(() => {
  const run = r.state(w).runs[0]
  expect(['completed', 'failed', 'paused', 'cancelled', 'unknown_outcome']).toContain(run?.status)
  return run
})
beforeEach(() => {
  mocks.kv.clear(); mocks.paused = false; mocks.connectorBinding = {}; mocks.connector.mockReset(); mocks.page.mockReset()
  mocks.page.mockImplementation(async (wc, method) => {
    if (method === 'agentSnapshot') return { documentId: `doc-${wc.id}`, snapshotId: 'snapshot', url: wc.getURL(), title: 'Allowed page', text: 'A useful observation.', tables: [], elements: [{ ref: 'field-ref', role: 'textbox', name: 'Title', editable: true }] }
    if (method === 'agentPrepare') return { token: 'one-use-page-token', documentId: `doc-${wc.id}`, description: 'Fill “Title”' }
    if (method === 'agentAct') return { outcome: 'verified', detail: 'Field value verified.' }
    if (method === 'agentDiagnostics') return { resources: [{ origin: 'https://one.example', durationMs: 50 }] }
    return true
  })
})
afterEach(() => { for (const r of runtimes.splice(0)) r.shutdown(); vi.useRealTimers() })

describe('agent recipe and scope validation', () => {
  it('rejects executable fields, duplicate tabs, credentials, and arbitrary URL schemes', () => {
    expect(() => parseDefinition({ ...AGENT_PRESETS[0], script: 'process.exit()' })).toThrow()
    expect(() => parseDefinition({ ...AGENT_PRESETS[0], steps: [{ origin: 'https://one.example', role: 'button', name: 'Send', action: 'click' }] })).toThrow()
    expect(() => parseStart(input('research', { tabIds: ['one', 'one'] }))).toThrow()
    for (const url of ['javascript:alert(1)', 'file:///tmp/x', 'https://u:p@example.com', 'data:text/html,test']) expect(() => agentOrigin(url)).toThrow()
    expect(sourceUrl('https://one.example/a?token=secret#private')).toBe('https://one.example/a')
    expect(redact('authorization=abc Bearer abc123 sk-1234567890123456')).not.toContain('abc123')
  })
  it('keeps imported recipes profile-owned and never accepts an imported id as ownership', () => {
    const saved = saveAgentDefinition('profile-a', { ...AGENT_PRESETS[0], id: 'foreign-id', builtin: true })
    expect(saved.id).not.toBe('foreign-id'); expect(saved.builtin).toBe(false)
    expect(agentDefinitions('profile-b').some((d) => d.id === saved.id)).toBe(false)
  })
  it('requires selected existing tabs and rejects paused/excluded pages before model requests', async () => {
    const generate = vi.fn(async () => answer()), r = runtime(generate), w = windowFixture()
    await expect(r.start(w, input('lens', { tabIds: ['missing'] }))).rejects.toThrow()
    mocks.paused = true
    await expect(r.start(w, input('lens'))).rejects.toThrow('paused')
    expect(generate).not.toHaveBeenCalled()
  })
})

describe('custom agent runtime boundaries', () => {
  it('gives each research worker only its own selected source and no tools', async () => {
    const requests: any[] = []
    const r = runtime(async (request) => { requests.push(request); return answer() }), w = windowFixture()
    await r.start(w, input('research'))
    await terminal(r, w)
    expect(requests[0].tools).toEqual([])
    expect(JSON.stringify(requests)).not.toContain('PRIVATE UNSELECTED TAB')
    expect(JSON.stringify(requests)).not.toContain('two.example')
    expect(r.state(w).runs[0].artifacts[0].sources[0].url).toBe('https://one.example/page')
  })
  it('rejects attempted access to an unselected tab without calling its page helper', async () => {
    let turn = 0
    const r = runtime(async () => ++turn === 1 ? call('page_read', { tab_id: 'two' }) : answer()), w = windowFixture()
    await r.start(w, input('lens')); await terminal(r, w)
    expect(mocks.page).not.toHaveBeenCalled()
    expect(r.state(w).runs[0].journal.some((j) => j.label.includes('outside'))).toBe(true)
  })
  it('does not expose writes, connectors or diagnostics to a guide agent', async () => {
    const generate = vi.fn(async () => answer()), r = runtime(generate), w = windowFixture()
    await r.start(w, input('guide')); await terminal(r, w)
    const names = generate.mock.calls[0][0].tools.map((t: any) => t.name)
    expect(names).toContain('page_inspect')
    expect(names).not.toContain('page_click'); expect(names).not.toContain('connector_call'); expect(names).not.toContain('diagnostics')
  })
  it('enforces one workflow per profile even across windows', async () => {
    const pending = new Promise<any>(() => {}), r = runtime(() => pending), w = windowFixture()
    await r.start(w, input('workflow'))
    await expect(r.start(windowFixture('profile-a', 'window-b'), input('workflow'))).rejects.toThrow('active workflow')
  })
  it('waits for approval, binds it to the window, and never executes a denied action', async () => {
    let turn = 0
    const r = runtime(async () => ++turn === 1 ? call('page_inspect', { tab_id: 'one' }) : call('page_fill', { tab_id: 'one', ref: 'field-ref', text: 'Approved text only' })), w = windowFixture()
    await r.start(w, input('workflow'))
    await vi.waitFor(() => expect(r.state(w).runs[0].approval).not.toBeNull())
    const run = r.state(w).runs[0]
    expect(() => r.approve(windowFixture('profile-a', 'wrong-window'), run.id, run.approval!.id, true)).toThrow()
    expect(mocks.page.mock.calls.some((c) => c[1] === 'agentAct')).toBe(false)
    r.approve(w, run.id, run.approval!.id, false)
    await terminal(r, w)
    expect(mocks.page.mock.calls.some((c) => c[1] === 'agentAct')).toBe(false)
    expect(r.state(w).runs[0].status).toBe('paused')
    expect(() => r.approve(w, run.id, run.approval!.id, true)).toThrow()
  })
  it('consumes an approval once and executes the exact prepared action', async () => {
    let turn = 0
    const r = runtime(async () => ++turn === 1 ? call('page_inspect', { tab_id: 'one' }) : turn === 2 ? call('page_fill', { tab_id: 'one', ref: 'field-ref', text: 'New title' }) : answer()), w = windowFixture()
    await r.start(w, input('workflow'))
    await vi.waitFor(() => expect(r.state(w).runs[0].approval).not.toBeNull())
    const run = r.state(w).runs[0], approval = run.approval!.id
    r.approve(w, run.id, approval, true)
    expect(() => r.approve(w, run.id, approval, true)).toThrow()
    await terminal(r, w)
    expect(mocks.page.mock.calls.filter((c) => c[1] === 'agentAct')).toHaveLength(1)
    expect(mocks.page.mock.calls.find((c) => c[1] === 'agentAct')![2]).toBe('one-use-page-token')
    expect(agentHistory('profile-a')[0].approval).toBeNull()
    expect(JSON.stringify(mocks.kv.get('agents:runs:profile-a'))).not.toContain('New title')
  })
  it('revokes pending approvals on same-URL navigation', async () => {
    let turn = 0
    const r = runtime(async () => ++turn === 1 ? call('page_inspect', { tab_id: 'one' }) : call('page_fill', { tab_id: 'one', ref: 'field-ref', text: 'Never insert' })), w = windowFixture()
    await r.start(w, input('workflow'))
    await vi.waitFor(() => expect(r.state(w).runs[0].approval).not.toBeNull())
    w.fixtureTabs.get('one').view.webContents.emit('did-start-navigation', { isMainFrame: true })
    await terminal(r, w)
    expect(mocks.page.mock.calls.some((c) => c[1] === 'agentAct')).toBe(false)
  })
  it('stops further effects when a dispatched click has an unknown outcome', async () => {
    const implementation = mocks.page.getMockImplementation()!
    mocks.page.mockImplementation((wc, method, ...args) => method === 'agentAct' ? { outcome: 'unknown', detail: 'No receipt.' } : implementation(wc, method, ...args))
    let turn = 0
    const r = runtime(async () => ++turn === 1 ? call('page_inspect', { tab_id: 'one' }) : call('page_click', { tab_id: 'one', ref: 'field-ref' })), w = windowFixture()
    await r.start(w, input('workflow'))
    await vi.waitFor(() => expect(r.state(w).runs[0].approval).not.toBeNull())
    const run = r.state(w).runs[0]; r.approve(w, run.id, run.approval!.id, true)
    await terminal(r, w)
    expect(r.state(w).runs[0].status).toBe('unknown_outcome')
    expect(mocks.page.mock.calls.filter((c) => c[1] === 'agentAct')).toHaveLength(1)
  })
  it('rechecks connector identity after approval before sending arguments', async () => {
    const r = runtime(async () => call('connector_call', { name: 'fixture_connector', arguments: { text: 'fixture' } })), w = windowFixture()
    await r.start(w, input('workflow', { connectorTools: ['fixture_connector'] }))
    await vi.waitFor(() => expect(r.state(w).runs[0].approval).not.toBeNull())
    const run = r.state(w).runs[0]; mocks.connectorBinding = {}; r.approve(w, run.id, run.approval!.id, true)
    await vi.waitFor(() => expect(r.state(w).runs[0].journal.some((j) => j.label.includes('identity changed'))).toBe(true))
    expect(mocks.connector).not.toHaveBeenCalled()
  })
  it('does not retry a connector when its transport reports an uncertain result', async () => {
    mocks.connector.mockResolvedValue('Error calling fixture_connector: connection reset')
    const generate = vi.fn(async () => call('connector_call', { name: 'fixture_connector', arguments: { text: 'fixture' } }))
    const r = runtime(generate), w = windowFixture()
    await r.start(w, input('workflow', { connectorTools: ['fixture_connector'] }))
    await vi.waitFor(() => expect(r.state(w).runs[0].approval).not.toBeNull())
    const run = r.state(w).runs[0]; r.approve(w, run.id, run.approval!.id, true)
    await terminal(r, w)
    expect(r.state(w).runs[0].status).toBe('unknown_outcome')
    expect(mocks.connector).toHaveBeenCalledTimes(1)
    expect(generate).toHaveBeenCalledTimes(1)
  })
  it('stops after a navigation request fails rather than guessing it had no effect', async () => {
    const generate = vi.fn(async () => call('tab_navigate', { tab_id: 'one', url: 'https://one.example/update' }))
    const r = runtime(generate), w = windowFixture()
    w.fixtureTabs.get('one').view.webContents.loadURL.mockRejectedValue(new Error('Connection reset after request'))
    await r.start(w, input('workflow'))
    await vi.waitFor(() => expect(r.state(w).runs[0].approval).not.toBeNull())
    const run = r.state(w).runs[0]; r.approve(w, run.id, run.approval!.id, true)
    await terminal(r, w)
    expect(r.state(w).runs[0].status).toBe('unknown_outcome')
    expect(generate).toHaveBeenCalledTimes(1)
  })
  it('diagnostic agents receive bounded diagnostic tools and all page effects still need approval', async () => {
    let turn = 0
    const generate = vi.fn(async () => ++turn === 1 ? call('diagnostics', { tab_id: 'one' }) : answer())
    const r = runtime(generate), w = windowFixture()
    await r.start(w, input('diagnose')); await terminal(r, w)
    expect(generate.mock.calls[0][0].tools.some((t: any) => t.name === 'diagnostics')).toBe(true)
    expect(mocks.page.mock.calls.some((c) => c[1] === 'agentDiagnostics')).toBe(true)
    expect(mocks.page.mock.calls.some((c) => c[1] === 'agentAct')).toBe(false)
  })
  it('watches page changes without any model calls and cancels the timer', async () => {
    vi.useFakeTimers()
    const generate = vi.fn(async () => answer()), r = runtime(generate), w = windowFixture()
    await r.start(w, input('watch'))
    await vi.advanceTimersByTimeAsync(1)
    const initial = mocks.page.getMockImplementation()!
    mocks.page.mockImplementation(async (...args) => ({ ...await initial(...args), text: 'Updated visible content' }))
    await vi.advanceTimersByTimeAsync(15_000)
    expect(r.state(w).runs[0].artifacts[0].kind).toBe('change')
    expect(generate).not.toHaveBeenCalled()
    r.stop(w, r.state(w).runs[0].id)
    const count = mocks.page.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.page.mock.calls).toHaveLength(count)
  })
  it('records only a granted document and saves parameterized recipes without field values', async () => {
    const generate = vi.fn(async () => answer()), r = runtime(generate), w = windowFixture()
    await r.start(w, input('teach'))
    await vi.waitFor(() => expect(mocks.page.mock.calls.some((c) => c[1] === 'agentStartRecording')).toBe(true))
    const wc = w.fixtureTabs.get('one').view.webContents
    const step = { origin: 'https://one.example', role: 'textbox', name: 'Title', action: 'fill' as const, parameter: 'field_1' }
    r.record(w, wc.id, { documentId: 'wrong-doc', step })
    expect(r.state(w).runs[0].recordedSteps).toHaveLength(0)
    r.record(w, wc.id, { documentId: `doc-${wc.id}`, step })
    const saved = r.saveRecording(w, r.state(w).runs[0].id, 'Reusable task')
    expect(saved.steps[0].parameter).toBe('field_1')
    expect(generate).not.toHaveBeenCalled()
    expect(saved.builtin).toBe(false)
  })
  it('does not replay persisted jobs or retain active approvals after restart', async () => {
    const r = runtime(() => new Promise(() => {})), w = windowFixture()
    await r.start(w, input('workflow'))
    const fresh = runtime(async () => answer())
    expect(fresh.state(w).runs[0].status).toBe('paused')
    expect(fresh.state(w).runs[0].approval).toBeNull()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectorFetch, McpManager } from '../src/main/agent/mcp'

describe('connector transport', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('rejects off-origin requests before forwarding credentials', async () => {
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    await expect(connectorFetch('https://service.example/mcp')('https://other.example/mcp', {
      headers: { 'X-Api-Key': 'test' }
    })).rejects.toThrow(/endpoint/)
    expect(request).not.toHaveBeenCalled()
  })
  it('forces redirect rejection even if the caller asks to follow', async () => {
    const request = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', request)
    await connectorFetch('https://service.example/mcp')('https://service.example/mcp', { redirect: 'follow' })
    expect(request.mock.calls[0][1].redirect).toBe('error')
  })
  it('rejects alternate paths and bounds decoded response bodies', async () => {
    const request = vi.fn().mockResolvedValue(new Response(new Uint8Array(8 * 1024 * 1024 + 1)))
    vi.stubGlobal('fetch', request)
    const safeFetch = connectorFetch('https://service.example/mcp')
    await expect(safeFetch('https://service.example/other')).rejects.toThrow(/endpoint/)
    expect(request).not.toHaveBeenCalled()
    const response = await safeFetch('https://service.example/mcp')
    await expect(response.text()).rejects.toThrow(/size limit/)
  })
  it('cannot run an enabled legacy local program', async () => {
    const manager: any = new McpManager()
    manager.servers.set('x', { config: { id: 'x', name: 'Legacy', enabled: true,
      transport: 'stdio', command: 'program', args: [], profileId: 'p1' }, client: null, tools: [] })
    await manager.connect('x')
    expect(manager.list('p1')[0].connected).toBe(false)
    expect(manager.list('p1')[0].error).toMatch(/disabled/)
  })
  it('cannot reconnect an imported disabled command', async () => {
    const manager: any = new McpManager()
    manager.servers.set('x', { config: { id: 'x', enabled: false }, client: null, tools: [] })
    const disconnect = vi.spyOn(manager, 'disconnect')
    await manager.connect('x')
    expect(disconnect).not.toHaveBeenCalled()
  })
  it('namespaces servers by identity even when their display names collide', () => {
    const manager: any = new McpManager()
    for (const id of ['a', 'b']) manager.servers.set(id, {
      config: { id, profileId: 'p1', name: 'Same name', enabled: true }, client: {},
      tools: [{ name: 'read', description: '', actionClass: 'read' }]
    })
    const names = manager.anthropicTools('p1').map((t: any) => t.name)
    expect(new Set(names).size).toBe(2)
    expect(manager.bindingOf(names[0])).not.toBe(manager.bindingOf(names[1]))
    expect(manager.anthropicTools('p2')).toEqual([])
    expect(manager.isMcpTool(names[0], 'p2')).toBe(false)
    expect(manager.anthropicTools()).toEqual([])
  })
})

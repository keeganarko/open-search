import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpServerConfig, McpServerStatus, ActionClass } from '@shared/types'
import * as db from '../store/db'
import { createHash } from 'node:crypto'
import { connectorDispatcher, validateConnectorEndpoint } from '../security/connectorNetwork'

/** Never forward connector credentials through HTTP redirects or to discovery URLs. */
export function connectorFetch(endpoint: string): typeof fetch {
  const allowed = validateConnectorEndpoint(endpoint)
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin !== allowed.origin || url.pathname !== allowed.pathname || url.search !== allowed.search) {
      throw new Error('Connector request left its approved endpoint.')
    }
    const response = await fetch(input, { ...init, redirect: 'error', credentials: 'omit',
      dispatcher: connectorDispatcher } as RequestInit)
    if (!response.body) return response
    let bytes = 0
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength
        if (bytes > 8 * 1024 * 1024) throw new Error('Connector response exceeded the size limit.')
        controller.enqueue(chunk)
      }
    }))
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
}
const qualifiedName = (id: string, name: string): string =>
  `mcp_${createHash('sha256').update(id).digest('hex').slice(0, 16)}__${name}`

/**
 * Stdio connectors need enough of the host environment to find executables and
 * their home/config directories, but they do not need every secret inherited by
 * the browser process. Connector-specific credentials still come from the
 * explicit `config.env` block.
 */
export function connectorBaseEnv(
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const exact = new Set([
    'PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
    'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'SYSTEMROOT', 'SystemRoot',
    'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL',
    'LANG', 'TERM', 'COLORTERM', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME',
    'XDG_DATA_HOME', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS'
  ])
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string') continue
    if (exact.has(key) || /^LC_[A-Z_]+$/.test(key)) out[key] = value
  }
  return out
}

interface Live {
  config: McpServerConfig
  client: Client | null
  tools: { name: string; description: string; schema: any; actionClass: ActionClass }[]
  error: string | null
  epoch?: number
}

function validateMap(
  value: Record<string, string> | undefined,
  kind: 'environment' | 'header'
): void {
  const entries = Object.entries(value ?? {})
  if (entries.length > 100) throw new Error(`Too many ${kind} values.`)
  for (const [key, item] of entries) {
    const validKey = kind === 'environment'
      ? /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)
      : /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(key)
    if (!validKey) throw new Error(`Invalid ${kind} name: ${key || '(empty)'}`)
    if (typeof item !== 'string' || item.length > 65_536 || /[\0\r\n]/.test(item)) {
      throw new Error(`Invalid value for ${key}.`)
    }
  }
}

/** Refuse malformed commands and remote plaintext transports before persisting. */
export function validateMcpConfig(config: McpServerConfig): McpServerConfig {
  if (!config || typeof config !== 'object') throw new Error('Invalid connector configuration.')
  const name = String(config.name ?? '').trim()
  if (!name || name.length > 100) throw new Error('Connector names must be 1–100 characters.')
  if (!['stdio', 'http'].includes(config.transport)) throw new Error('Unsupported connector transport.')

  if (config.transport === 'stdio') {
    if (config.enabled) throw new Error('Local connectors are disabled until an operating-system sandbox is available.')
    const command = String(config.command ?? '').trim()
    if (!command || command.length > 4_096 || /[\0\r\n]/.test(command)) {
      throw new Error('Enter one valid connector command.')
    }
    if (!Array.isArray(config.args) || config.args.length > 100
      || config.args.some((arg) => typeof arg !== 'string' || arg.length > 8_192 || arg.includes('\0'))) {
      throw new Error('Connector arguments are invalid or too large.')
    }
    validateMap(config.env, 'environment')
  } else {
    validateConnectorEndpoint(String(config.url ?? ''))
    validateMap(config.headers, 'header')
    if (Object.keys(config.headers ?? {}).some((k) => /^(host|connection|content-length|transfer-encoding|proxy-.*|upgrade)$/i.test(k))) {
      throw new Error('Connector routing headers cannot be overridden.')
    }
  }
  return { ...config, name }
}

/**
 * Action class is inferred from the tool's own name and description. It is a
 * conservative guess that decides whether a call needs approval — when the
 * signal is ambiguous the tool is treated as an external write, not a read.
 */
/**
 * MCP tool names are `create_payment`, `deleteIssue`, `files/write` — none of
 * which tokenize under `\b`, because `_` is a word character and camelCase has
 * no boundary in it at all. Splitting first is what makes the patterns below
 * fire; without it `delete_repository` scored as an ordinary write.
 */
function words(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .toLowerCase()
    .trim()
}

/**
 * Stems rather than whole words, so "payments", "deleted" and "removal" all
 * land. Every rule here is allowed to over-match: the cost of a false positive
 * is one approval sheet, and the cost of a false negative is a silent payment.
 */
export function inferActionClass(name: string, description = ''): ActionClass {
  const s = words(`${name} ${description}`)
  if (/\b(pay|purchase|checkout|charg|refund|transfer|invoic|delet|destroy|remov|revok|password|credential|token|deploy|merg|force push|wipe|terminat|cancel)\w*/.test(s)) {
    return 'sensitive'
  }
  if (/\b(draft|compos|prepar|preview)\w*/.test(s)) return 'external_draft'
  // `add` and `set` take an explicit suffix list rather than `\w*`: `add\w*`
  // swallows "address", which turns half the read tools into writes.
  if (/\b((send|post|publish|creat|updat|edit|writ|upload|comment|repl|invit|shar|archiv|assign|schedul|move|renam)\w*|adds?|added|adding|sets?|setting)\b/.test(s)) {
    return 'external_write'
  }
  if (/\b(search|find|list|get|read|fetch|quer|lookup|view|show|describ|count|browse)\w*/.test(s)) {
    return 'read'
  }
  return 'external_write'
}

export class McpManager {
  private servers = new Map<string, Live>()

  async init(): Promise<void> {
    for (const config of db.listMcpServers()) {
      this.servers.set(config.id, { config, client: null, tools: [], error: null })
      if (config.enabled) await this.connect(config.id)
    }
  }

  list(profileId?: string): McpServerStatus[] {
    return [...this.servers.values()].filter((s) => !profileId || s.config.profileId === profileId).map((s) => ({
      id: s.config.id,
      name: s.config.name,
      connected: !!s.client,
      error: s.error,
      toolCount: s.tools.length,
      tools: s.tools.map((t) => ({
        name: t.name, description: t.description, actionClass: t.actionClass
      }))
    }))
  }

  configs(): McpServerConfig[] {
    return [...this.servers.values()].map((s) => s.config)
  }

  async save(config: McpServerConfig): Promise<void> {
    config = validateMcpConfig(config)
    db.upsertMcpServer(config)
    await this.disconnect(config.id)
    this.servers.set(config.id, { config, client: null, tools: [], error: null })
    if (config.enabled) await this.connect(config.id)
  }

  async remove(id: string): Promise<void> {
    await this.disconnect(id)
    this.servers.delete(id)
    db.deleteMcpServer(id)
  }

  async connect(id: string): Promise<void> {
    const live = this.servers.get(id)
    if (!live || !live.config.enabled) return
    await this.disconnect(id)
    const epoch = live.epoch = (live.epoch ?? 0) + 1
    let client: Client | null = null
    try {
      live.config = validateMcpConfig(live.config)
      client = new Client(
        { name: 'voyager', version: '0.1.0' },
        { capabilities: {} }
      )
      if (!live.config.profileId) throw new Error('Reconnect this connector from its intended profile to grant access.')
      const transport = new StreamableHTTPClientTransport(new URL(live.config.url!), {
            requestInit: { headers: live.config.headers ?? {}, redirect: 'error' },
            fetch: connectorFetch(live.config.url!)
          })

      await client.connect(transport)
      const { tools } = await client.listTools()
      if (this.servers.get(id) !== live || live.epoch !== epoch || !live.config.enabled) {
        await client.close()
        return
      }
      live.client = client
      live.error = null
      live.tools = tools.filter((t) => /^[a-zA-Z0-9_-]{1,100}$/.test(t.name)).map((t) => ({
        name: t.name,
        description: t.description ?? '',
        schema: t.inputSchema,
        actionClass: inferActionClass(t.name, t.description ?? '')
      }))
    } catch (err) {
      await client?.close().catch(() => {})
      if (this.servers.get(id) !== live || live.epoch !== epoch) return
      live.client = null
      live.tools = []
      live.error = err instanceof Error ? err.message : String(err)
    }
  }

  async disconnect(id: string): Promise<void> {
    const live = this.servers.get(id)
    if (!live) return
    live.epoch = (live.epoch ?? 0) + 1
    const client = live.client
    live.client = null
    live.tools = []
    try { await client?.close() } catch { /* already down */ }
  }

  /**
   * Every connected server's tools, namespaced so two servers can both expose
   * a tool called "search" without colliding.
   */
  anthropicTools(profileId?: string): { name: string; description: string; input_schema: any; actionClass: ActionClass }[] {
    const out: { name: string; description: string; input_schema: any; actionClass: ActionClass }[] = []
    for (const live of this.servers.values()) {
      if (!live.client || !profileId || live.config.profileId !== profileId) continue
      for (const t of live.tools) {
        out.push({
          name: qualifiedName(live.config.id, t.name),
          description: `[${live.config.name}] ${t.description}`.slice(0, 1024),
          input_schema: t.schema ?? { type: 'object', properties: {} },
          actionClass: t.actionClass
        })
      }
    }
    return out
  }

  isMcpTool(name: string, profileId?: string): boolean {
    return !!profileId && this.resolve(name)?.live.config.profileId === profileId
  }

  private resolve(qualified: string): { live: Live; tool: string } | null {
    for (const live of this.servers.values()) {
      if (!live.client || !live.config.enabled) continue
      const tool = live.tools.find((t) => qualifiedName(live.config.id, t.name) === qualified)
      if (tool) return { live, tool: tool.name }
    }
    return null
  }

  actionClassOf(qualified: string): ActionClass {
    const hit = this.resolve(qualified)
    if (!hit) return 'external_write'
    return hit.live.tools.find((t) => t.name === hit.tool)?.actionClass ?? 'external_write'
  }

  bindingOf(qualified: string): object | null {
    return this.resolve(qualified)?.live.client ?? null
  }

  async call(qualified: string, args: unknown, profileId?: string): Promise<string> {
    const hit = this.resolve(qualified)
    if (!hit?.live.client || !profileId || hit.live.config.profileId !== profileId) return `Error: no permitted MCP server provides ${qualified}.`
    if (Buffer.byteLength(JSON.stringify(args ?? {})) > 128 * 1024) return 'Error: connector arguments are too large.'
    try {
      const res = await hit.live.client.callTool({
        name: hit.tool,
        arguments: (args ?? {}) as Record<string, unknown>
      })
      const content = (res as any).content
      if (!Array.isArray(content)) return JSON.stringify(res).slice(0, 20000)
      const parts = content.map((c: any) => {
        if (c.type === 'text') return c.text
        if (c.type === 'resource') return c.resource?.text ?? JSON.stringify(c.resource)
        return `[${c.type}]`
      })
      const text = parts.join('\n').slice(0, 20000)
      return (res as any).isError ? `Tool reported an error: ${text}` : text
    } catch (err) {
      return `Error calling ${qualified}: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  async shutdown(): Promise<void> {
    for (const id of this.servers.keys()) await this.disconnect(id)
  }
}

export const mcp = new McpManager()

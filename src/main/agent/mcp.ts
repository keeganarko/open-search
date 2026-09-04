import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpServerConfig, McpServerStatus, ActionClass } from '@shared/types'
import * as db from '../store/db'

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
    let url: URL
    try { url = new URL(String(config.url ?? '')) } catch { throw new Error('Enter a valid connector URL.') }
    if (url.username || url.password) throw new Error('Put credentials in headers, not the URL.')
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      throw new Error('Hosted connectors must use HTTPS. Plain HTTP is allowed only on this computer.')
    }
    validateMap(config.headers, 'header')
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

  list(): McpServerStatus[] {
    return [...this.servers.values()].map((s) => ({
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
    if (!live) return
    await this.disconnect(id)
    try {
      live.config = validateMcpConfig(live.config)
      const client = new Client(
        { name: 'voyager', version: '0.1.0' },
        { capabilities: {} }
      )
      const transport = live.config.transport === 'stdio'
        ? new StdioClientTransport({
            command: live.config.command!,
            args: live.config.args ?? [],
            env: { ...connectorBaseEnv(), ...(live.config.env ?? {}) }
          })
        : new StreamableHTTPClientTransport(new URL(live.config.url!), {
            requestInit: { headers: live.config.headers ?? {} }
          })

      await client.connect(transport)
      const { tools } = await client.listTools()
      live.client = client
      live.error = null
      live.tools = tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        schema: t.inputSchema,
        actionClass: inferActionClass(t.name, t.description ?? '')
      }))
    } catch (err) {
      live.client = null
      live.tools = []
      live.error = err instanceof Error ? err.message : String(err)
    }
  }

  async disconnect(id: string): Promise<void> {
    const live = this.servers.get(id)
    if (!live?.client) return
    try { await live.client.close() } catch { /* already down */ }
    live.client = null
    live.tools = []
  }

  /**
   * Every connected server's tools, namespaced so two servers can both expose
   * a tool called "search" without colliding.
   */
  anthropicTools(): { name: string; description: string; input_schema: any; actionClass: ActionClass }[] {
    const out: { name: string; description: string; input_schema: any; actionClass: ActionClass }[] = []
    for (const live of this.servers.values()) {
      if (!live.client) continue
      const prefix = live.config.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
      for (const t of live.tools) {
        out.push({
          name: `${prefix}__${t.name}`.slice(0, 128),
          description: `[${live.config.name}] ${t.description}`.slice(0, 1024),
          input_schema: t.schema ?? { type: 'object', properties: {} },
          actionClass: t.actionClass
        })
      }
    }
    return out
  }

  isMcpTool(name: string): boolean {
    return name.includes('__') && this.resolve(name) !== null
  }

  private resolve(qualified: string): { live: Live; tool: string } | null {
    const idx = qualified.indexOf('__')
    if (idx < 0) return null
    const prefix = qualified.slice(0, idx)
    const tool = qualified.slice(idx + 2)
    for (const live of this.servers.values()) {
      const p = live.config.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
      if (p === prefix && live.tools.some((t) => t.name === tool)) return { live, tool }
    }
    return null
  }

  actionClassOf(qualified: string): ActionClass {
    const hit = this.resolve(qualified)
    if (!hit) return 'external_write'
    return hit.live.tools.find((t) => t.name === hit.tool)?.actionClass ?? 'external_write'
  }

  async call(qualified: string, args: unknown): Promise<string> {
    const hit = this.resolve(qualified)
    if (!hit?.live.client) return `Error: no connected MCP server provides ${qualified}.`
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

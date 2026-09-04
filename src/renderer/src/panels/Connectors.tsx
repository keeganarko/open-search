import { useEffect, useState, type JSX } from 'react'
import type { McpServerConfig, McpServerStatus } from '@shared/types'
import Panel from './Panel'

interface Preset {
  name: string
  note: string
  /**
   * Whether the endpoint or package was checked against the live registry.
   * An unverified preset fills in nothing it cannot vouch for — a wrong command
   * here would hand a stranger's package an OAuth token for your mail.
   */
  verified: boolean
  config: Partial<McpServerConfig>
}

/**
 * Presets are just prefilled MCP server configs. Open Search is a plain MCP client, so
 * anything that speaks MCP over stdio or streamable HTTP works here.
 *
 * The reference stdio servers for Gmail, Slack and GitHub were deprecated on npm
 * ("Package no longer supported"), so the ones that have an official hosted
 * endpoint now point at it instead.
 */
const PRESETS: Preset[] = [
  {
    name: 'GitHub',
    note: 'Official hosted endpoint. Paste a personal access token as the Authorization header, with the scopes you want Open Search to have.',
    verified: true,
    config: {
      transport: 'http', url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: 'Bearer ' }
    }
  },
  {
    name: 'Notion',
    note: 'Official hosted endpoint. Paste the token Notion gives you as an Authorization header.',
    verified: true,
    config: {
      transport: 'http', url: 'https://mcp.notion.com/mcp',
      headers: { Authorization: 'Bearer ' }
    }
  },
  {
    name: 'Linear',
    note: 'Official hosted endpoint. Paste your Linear API key as the Authorization header.',
    verified: true,
    config: {
      transport: 'http', url: 'https://mcp.linear.app/mcp',
      headers: { Authorization: 'Bearer ' }
    }
  },
  {
    name: 'Filesystem',
    note: 'Give it one directory. Open Search can then read and write only inside it.',
    verified: true,
    config: {
      transport: 'stdio', command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/you/Documents']
    }
  },
  {
    name: 'Gmail + Calendar',
    note: 'There is no official Google Workspace MCP server. Several community ones exist on npm; pick one you trust before giving it a mailbox, then put its command below.',
    verified: false,
    config: { transport: 'stdio', command: 'npx', args: ['-y', ''] }
  },
  {
    name: 'Slack',
    note: 'The reference Slack server is deprecated and there is no official hosted endpoint. Point this at whichever Slack MCP server you run, with SLACK_BOT_TOKEN and SLACK_TEAM_ID set.',
    verified: false,
    config: {
      transport: 'stdio', command: 'npx', args: ['-y', ''],
      env: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: '' }
    }
  }
]
const blank: McpServerConfig = {
  id: '', name: '', enabled: true, transport: 'stdio', command: '', args: [], env: {},
  url: '', headers: {}
}

function KV({ value, onChange, label }: {
  value: Record<string, string>; onChange: (v: Record<string, string>) => void; label: string
}): JSX.Element {
  const rows = Object.entries(value)
  return (
    <div className="field">
      <label>{label}</label>
      {rows.map(([k, v], i) => (
        <div className="row" key={i} style={{ marginBottom: 5 }}>
          <input type="text" placeholder="KEY" value={k} style={{ flex: 1 }}
            onChange={(e) => {
              const next = { ...value }
              delete next[k]
              next[e.target.value] = v
              onChange(next)
            }} />
          <input type="password" placeholder="value" value={v} style={{ flex: 2 }}
            onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
          <button className="iconbtn" onClick={() => {
            const next = { ...value }
            delete next[k]
            onChange(next)
          }}>×</button>
        </div>
      ))}
      <button className="btn" onClick={() => onChange({ ...value, '': '' })}>Add</button>
    </div>
  )
}

export default function Connectors({ onClose, toast }: {
  onClose: () => void; toast: (m: string, k?: 'info' | 'error') => void
}): JSX.Element {
  const [servers, setServers] = useState<McpServerStatus[]>([])
  const [editing, setEditing] = useState<McpServerConfig | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = (): void => { void window.kia.connectors.status().then(setServers) }
  useEffect(refresh, [])

  const save = async (): Promise<void> => {
    if (!editing?.name) return toast('Give the connector a name.', 'error')
    setBusy(true)
    try {
      setServers(await window.kia.connectors.save(editing))
      setEditing(null)
    } catch (e) { toast(String((e as Error).message), 'error') }
    setBusy(false)
  }

  return (
    <Panel
      title="Connectors"
      onClose={onClose}
      actions={<button className="btn" onClick={() => setEditing({ ...blank })}>Add connector</button>}
    >
      {editing ? (
        <>
          {!editing.name && (
            <>
              <div className="sectiontitle">Start from a preset</div>
              {PRESETS.map((p) => (
                <button className="list-row" key={p.name}
                  onClick={() => setEditing({ ...blank, ...p.config, name: p.name } as McpServerConfig)}>
                  <div className="main">
                    <div className="t">
                      {p.name}{' '}
                      <span className={`badge ${p.verified ? 'ok' : 'warn'}`}>
                        {p.verified ? 'checked' : 'needs a server'}
                      </span>
                    </div>
                    <div className="s" style={{ whiteSpace: 'normal' }}>{p.note}</div>
                  </div>
                </button>
              ))}
              <div className="sectiontitle">Or configure by hand</div>
            </>
          )}

          <div className="field">
            <label>Name</label>
            <input type="text" value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Transport</label>
            <select value={editing.transport}
              onChange={(e) => setEditing({
                ...editing, transport: e.target.value as McpServerConfig['transport']
              })}>
              <option value="stdio">stdio — a local command</option>
              <option value="http">http — a hosted MCP endpoint</option>
            </select>
          </div>

          {editing.transport === 'stdio' ? (
            <>
              <div className="field">
                <label>Command</label>
                <input type="text" placeholder="npx" value={editing.command ?? ''}
                  onChange={(e) => setEditing({ ...editing, command: e.target.value })} />
              </div>
              <div className="field">
                <label>Arguments</label>
                <div className="desc">One per line.</div>
                <textarea rows={4} value={(editing.args ?? []).join('\n')}
                  onChange={(e) => setEditing({
                    ...editing, args: e.target.value.split('\n').filter(Boolean)
                  })} />
              </div>
              <KV label="Environment" value={editing.env ?? {}}
                onChange={(env) => setEditing({ ...editing, env })} />
            </>
          ) : (
            <>
              <div className="field">
                <label>URL</label>
                <input type="text" placeholder="https://…/mcp" value={editing.url ?? ''}
                  onChange={(e) => setEditing({ ...editing, url: e.target.value })} />
              </div>
              <KV label="Headers" value={editing.headers ?? {}}
                onChange={(headers) => setEditing({ ...editing, headers })} />
            </>
          )}

          <label className="check">
            <input type="checkbox" checked={editing.enabled}
              onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} />
            Enabled
          </label>

          <div className="row">
            <button className="btn primary" onClick={save} disabled={busy}>
              {busy ? 'Connecting…' : 'Save & connect'}
            </button>
            <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <div className="desc" style={{ marginBottom: 16, maxWidth: 640 }}>
            Connectors are MCP servers. Open Search lists their tools to the model and sorts each one
            into an action class — anything that writes outside Open Search stops and asks you first.
          </div>
          {servers.length === 0 && <div className="empty">No connectors yet.</div>}
          {servers.map((s) => (
            <div className="card" key={s.id}>
              <div className="row">
                <div style={{ flex: 1 }}>
                  <div className="t">{s.name}</div>
                  <div className="s">
                    {s.connected ? `${s.toolCount} tools` : s.error ?? 'Not connected'}
                  </div>
                </div>
                <span className={`badge ${s.connected ? 'ok' : 'err'}`}>
                  {s.connected ? 'connected' : 'off'}
                </span>
                <button className="btn" onClick={async () => {
                  setServers(await window.kia.connectors.reconnect(s.id))
                }}>Reconnect</button>
                <button className="btn danger" onClick={async () => {
                  setServers(await window.kia.connectors.remove(s.id))
                }}>Remove</button>
              </div>
              {s.tools.length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {s.tools.map((t) => (
                    <span className="badge" key={t.name} title={`${t.description}\n\n${t.actionClass}`}>
                      {t.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </Panel>
  )
}

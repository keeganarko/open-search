import { useEffect, useState, type FormEvent } from 'react'
import type { AgentDefinition, AgentArtifact, AgentMode, AgentRun } from '@shared/agents'
import type { FullWindowState } from '@shared/types'
import { AgentIcon, activeAgent, useAgents } from '../components/AgentLauncher'
import { Markdown } from '../markdown'

const host = (url: string): string => { try { return new URL(url).host } catch { return url } }
const modes: AgentMode[] = ['research', 'workflow', 'lens', 'watch', 'teach', 'diagnose', 'guide']
const modeNames: Record<AgentMode, string> = { research: 'Research', workflow: 'Website workflow', lens: 'Page views and tables', watch: 'Watch for changes', teach: 'Record a workflow', diagnose: 'Page investigation', guide: 'Guided instructions' }
const symbols: Record<AgentMode, string> = { research: '↗', workflow: '→', lens: '▤', watch: '◷', teach: '◎', diagnose: '⌘', guide: '◇' }
const clipboardCell = (value: string): string => {
  const text = value.replace(/[\t\r\n]/g, ' ')
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text
}
const statusLabel: Record<AgentRun['status'], string> = { running: 'Working', watching: 'Watching', recording: 'Recording', awaiting_approval: 'Needs review', paused: 'Paused', completed: 'Finished', cancelled: 'Stopped', failed: 'Couldn’t finish', unknown_outcome: 'Check the page' }

function Artifact({ item }: { item: AgentArtifact }) {
  const [sort, setSort] = useState<{ column: number; ascending: boolean } | null>(null)
  const rows = sort ? [...item.rows].sort((a, b) => (a[sort.column] ?? '').localeCompare(b[sort.column] ?? '', undefined, { numeric: true }) * (sort.ascending ? 1 : -1)) : item.rows
  return <section className="agent-artifact">
    <h4>{item.title}</h4><div className="agent-prose"><Markdown text={item.body} /></div>
    {item.columns.length > 0 && <div className="agent-table-scroll"><table><thead><tr>{item.columns.map((c, i) => <th key={i}>
      <button onClick={() => setSort({ column: i, ascending: sort?.column === i ? !sort.ascending : true })}>{c}{sort?.column === i ? sort.ascending ? ' ↑' : ' ↓' : ''}</button>
    </th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>}
    {item.sources.length > 0 && <details className="agent-sources"><summary>{item.sources.length} source{item.sources.length === 1 ? '' : 's'}</summary>
      {item.sources.map((s, i) => <a key={i} href={s.url} title={`Observed ${new Date(s.observedAt).toLocaleString()}`}
        onClick={(e) => { e.preventDefault(); window.voyager.tabs.create({ url: s.url }) }}>{s.title || host(s.url)}</a>)}
    </details>}
    <button className="agent-text-button" onClick={() => void window.voyager.copy(`${item.title}\n\n${item.body}\n${[item.columns, ...item.rows].map((r) => r.map(clipboardCell).join('\t')).join('\n')}\n${item.sources.map((s) => s.url).join('\n')}`)}>Copy result</button>
  </section>
}

export default function Agents({ browser, onChat }: { browser: FullWindowState; onChat: () => void }) {
  const { state, setState, error, setError } = useAgents(browser.profileId)
  const [chosen, setChosen] = useState<AgentDefinition | null>(null)
  const [showChooser, setShowChooser] = useState(true)
  const [editing, setEditing] = useState<AgentDefinition | null>(null)
  const [importing, setImporting] = useState(false)
  const [recipeText, setRecipeText] = useState('')
  const [task, setTask] = useState('')
  const [selected, setSelected] = useState<string[]>(browser.activeTabId ? [browser.activeTabId] : [])
  const [connectorTools, setConnectorTools] = useState<string[]>([])
  const [parameters, setParameters] = useState<Record<string, string>>({})
  const [interval, setInterval] = useState(60)
  const [busy, setBusy] = useState(false)
  const [openRun, setOpenRun] = useState<string | null>(null)
  const [recordingName, setRecordingName] = useState('My workflow')
  const [checks, setChecks] = useState<Record<string, Record<string, string>>>({})
  const live = state.runs.filter((r) => activeAgent(r.status))
  useEffect(() => { if (state.runs.some((r) => r.approval)) setShowChooser(false) }, [state.runs])
  const eligible = browser.tabs.filter((t) => /^https?:\/\//i.test(t.url))
  const perform = async (fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')) }
    finally { setBusy(false) }
  }
  const pick = (d: AgentDefinition) => { setChosen(d); setEditing(null); setImporting(false); setTask(''); setParameters({}); setConnectorTools([]); setError('') }
  const start = (e: FormEvent) => {
    e.preventDefault()
    if (!chosen) return
    void perform(async () => {
      const r = await window.voyager.agents.start({ definitionId: chosen.id, task, tabIds: selected.filter((id) => eligible.some((t) => t.id === id)), connectorTools, parameters, intervalSeconds: interval })
      setState(await window.voyager.agents.state()); setChosen(null); setShowChooser(false); setParameters({}); setOpenRun(r.id)
    })
  }
  const custom = () => setEditing({ schemaVersion: 1, id: '', name: '', description: '', mode: 'research', instructions: '', steps: [], builtin: false })
  const runningHere = (r: AgentRun) => activeAgent(r.status) && r.windowKey === state.windowKey

  return <aside className="sidebar agents-panel" style={{ width: browser.sidebarWidth }} aria-label="Agents">
    <div className="sidebar-head"><AgentIcon /><span className="title">Agents</span>
      <button className="agent-text-button" onClick={onChat}>Chat</button>
      <button className="iconbtn" title="Hide agent panel" aria-label="Hide agent panel" onClick={() => window.voyager.layout.sidebar(false)}>×</button>
    </div>
    <div className="agents-scroll">
      <div className="agents-intro"><h2>A little help, on your terms.</h2><p>Choose a task and the tabs it can use. Keep browsing while it works.</p></div>
      {error && <div className="agent-error" role="alert">{error}</div>}
      {!chosen && !editing && !importing && !showChooser && <button className="agent-launcher agent-start-another" onClick={() => setShowChooser(true)}>+ Start another agent</button>}
      {!chosen && !editing && !importing && showChooser && <>
        <div className="agent-section-label"><span>Start an agent</span><button className="agent-text-button" onClick={custom}>+ Custom</button></div>
        <div className="agent-grid">{state.definitions.map((d) => <button className="agent-tile" key={d.id} onClick={() => pick(d)}>
          <span className="agent-symbol" aria-hidden="true">{symbols[d.mode]}</span><strong>{d.name}</strong><span>{d.description}</span>
        </button>)}</div>
        <button className="agent-text-button" onClick={() => setImporting(true)}>Import a recipe</button>
      </>}
      {importing && <form className="agent-form" onSubmit={(e) => { e.preventDefault(); void perform(async () => { setState(await window.voyager.agents.save(JSON.parse(recipeText))); setImporting(false); setRecipeText('') }) }}>
        <h3>Import a recipe</h3><p>Paste a Voyager recipe. It receives no page access until you start it.</p>
        <label>Recipe JSON<textarea required maxLength={48_000} rows={8} value={recipeText} onChange={(e) => setRecipeText(e.target.value)} /></label>
        <div className="agent-button-row"><button className="btn" type="button" onClick={() => setImporting(false)}>Cancel</button><button className="btn primary" disabled={busy}>Import</button></div>
      </form>}
      {editing && <form className="agent-form" onSubmit={(e) => { e.preventDefault(); void perform(async () => { setState(await window.voyager.agents.save(editing)); setEditing(null) }) }}>
        <h3>{editing.id ? 'Edit agent' : 'Make your own agent'}</h3>
        <label>Name<input required maxLength={100} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="My research partner" /></label>
        <label>What it does<input maxLength={300} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="A short description" /></label>
        <label>Capabilities<select value={editing.mode} onChange={(e) => setEditing({ ...editing, mode: e.target.value as AgentMode, steps: e.target.value === 'workflow' ? editing.steps : [] })}>{modes.map((m) => <option key={m} value={m}>{modeNames[m]}</option>)}</select></label>
        <label>Instructions<textarea required rows={5} maxLength={8000} value={editing.instructions} onChange={(e) => setEditing({ ...editing, instructions: e.target.value })} placeholder="What should this agent look for or help you do?" /></label>
        <p>Instructions cannot override tab permissions or action approvals.</p>
        <div className="agent-button-row"><button className="btn" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="btn primary" disabled={busy}>Save agent</button></div>
      </form>}
      {chosen && <form className="agent-form" onSubmit={start}>
        <div className="agent-section-label"><h3>{chosen.name}</h3><button className="agent-text-button" type="button" onClick={() => setChosen(null)}>Back</button></div>
        {!['watch', 'teach'].includes(chosen.mode) && <label>Your task<textarea autoFocus rows={3} maxLength={8000} value={task} onChange={(e) => setTask(e.target.value)} placeholder={chosen.mode === 'research' ? 'Compare the options, pricing, and tradeoffs…' : 'What would you like to get done?'} /></label>}
        <fieldset><legend>Tabs this agent can use <span>({selected.filter((id) => eligible.some((t) => t.id === id)).length}/6)</span></legend>
          <div className="agent-tab-picker">{eligible.length === 0 && <p>Open an HTTP or HTTPS page first.</p>}
          {eligible.map((t) => <label className="agent-tab-choice" key={t.id}><input type="checkbox" checked={selected.includes(t.id)} disabled={!selected.includes(t.id) && selected.length >= 6}
            onChange={(e) => setSelected(e.target.checked ? [...selected, t.id] : selected.filter((id) => id !== t.id))} />
            <span><strong>{t.title || host(t.url)}</strong><small>{host(t.url)}</small></span></label>)}</div>
        </fieldset>
        {chosen.mode === 'workflow' && state.connectorTools.length > 0 && <details><summary>Optional connector tools</summary>{state.connectorTools.map((t) => <label className="agent-tab-choice" key={t.name}>
          <input type="checkbox" checked={connectorTools.includes(t.name)} onChange={(e) => setConnectorTools(e.target.checked ? [...connectorTools, t.name] : connectorTools.filter((n) => n !== t.name))} /><span>{t.description || t.name}</span>
        </label>)}</details>}
        {chosen.steps.filter((s) => s.parameter).map((s) => <label key={s.parameter}>{s.name} ({s.parameter})<input required maxLength={4000} value={parameters[s.parameter!] ?? ''} autoComplete="off" onChange={(e) => setParameters({ ...parameters, [s.parameter!]: e.target.value })} /></label>)}
        {chosen.mode === 'watch' && <label>Check loaded pages every<select value={interval} onChange={(e) => setInterval(Number(e.target.value))}><option value={15}>15 seconds</option><option value={60}>1 minute</option><option value={300}>5 minutes</option></select></label>}
        <p className="agent-consent">{chosen.mode === 'watch' ? 'Local text checks for up to one hour while Voyager is open. No model calls or automatic page refreshes.'
          : chosen.mode === 'teach' ? 'Record clicks and field names for up to five minutes or 24 steps. Field values and recognized password/payment fields are omitted. Only top-level pages are supported.'
          : chosen.steps.length ? 'Runs your reviewed recipe locally. Every website action needs approval. No model calls.'
          : `Selected page content and your task go to Anthropic. History and memory are not included.${chosen.mode === 'diagnose' ? ' Page diagnostics include resource timings and console errors, which may contain private information. Website actions need approval.' : ''}${chosen.mode === 'workflow' ? ' Website actions and connector calls need your approval.' : ''}`}</p>
        <div className="agent-button-row"><button className="btn primary" disabled={busy || !selected.some((id) => eligible.some((t) => t.id === id))}>{busy ? 'Starting…' : chosen.mode === 'teach' ? 'Start recording' : chosen.mode === 'watch' ? 'Start watching' : 'Start agent'}</button>
          <button className="agent-text-button" type="button" onClick={() => void window.voyager.copy(JSON.stringify(chosen, null, 2))}>Copy recipe</button></div>
        {!chosen.builtin && <div className="agent-button-row"><button className="agent-text-button" type="button" onClick={() => { setEditing(chosen); setChosen(null) }}>Edit agent</button>
          <button className="agent-text-button" type="button" onClick={() => void perform(async () => { setState(await window.voyager.agents.remove(chosen.id)); setChosen(null) })}>Remove agent</button></div>}
      </form>}
      {state.runs.length > 0 && <div className="agent-section-label"><span>{live.length ? `${live.length} active · Your runs` : 'Your runs'}</span></div>}
      {state.runs.map((r) => <section key={r.id} className={`agent-run${r.approval ? ' needs-review' : ''}`}>
        <button className="agent-run-heading" onClick={() => setOpenRun(openRun === r.id ? null : r.id)} aria-expanded={openRun === r.id}>
          <span className={`agent-status-dot ${activeAgent(r.status) ? 'active' : ''}`} /><strong>{r.name}</strong><span>{statusLabel[r.status]}</span>
        </button>
        <p className="agent-run-message" aria-live="polite">{r.message}</p>
        {runningHere(r) && <button className="agent-text-button" disabled={busy} onClick={() => void perform(async () => setState(await window.voyager.agents.stop(r.id)))}>{r.mode === 'teach' ? 'Finish recording' : 'Stop / take over'}</button>}
        {activeAgent(r.status) && !runningHere(r) && <small>Active in another window.</small>}
        {runningHere(r) && r.approval && <div className="agent-approval" role="region" aria-label="Review agent action">
          <strong>{r.approval.title}</strong><div className="agent-destination">{r.approval.destination}</div><pre>{r.approval.detail}</pre>
          <small>One action · expires {new Date(r.approval.expiresAt).toLocaleTimeString()}</small>
          <div className="agent-button-row"><button className="btn" disabled={busy} onClick={() => void perform(async () => setState(await window.voyager.agents.approve(r.id, r.approval!.id, false)))}>Decline</button>
          <button className="btn primary" disabled={busy} onClick={() => void perform(async () => setState(await window.voyager.agents.approve(r.id, r.approval!.id, true)))}>Approve this action</button></div>
        </div>}
        {openRun === r.id && <div className="agent-run-body">
          {r.task && <p className="agent-run-task">{r.task}</p>}
          {r.artifacts.map((item) => <Artifact key={item.id} item={item} />)}
          {r.recordedSteps.length > 0 && <div className="agent-recording"><strong>Recorded steps ({r.recordedSteps.length})</strong><ol>{r.recordedSteps.map((s, i) => <li key={i}>{s.action === 'fill' ? 'Fill' : 'Click'} “{s.name}”{s.parameter ? ` with ${s.parameter}` : ''}
            {s.action === 'click' && !activeAgent(r.status) && <label>New text to verify after this click<input placeholder="For example: Draft ready" maxLength={200} value={checks[r.id]?.[i] ?? ''} onChange={(e) => setChecks({ ...checks, [r.id]: { ...checks[r.id], [i]: e.target.value } })} /></label>}</li>)}</ol>
            {!activeAgent(r.status) && <><p>Clicks stop the workflow if neither the expected new text nor a link destination can be verified.</p><label>Workflow name<input value={recordingName} maxLength={100} onChange={(e) => setRecordingName(e.target.value)} /></label><button className="btn" disabled={busy || !recordingName.trim()} onClick={() => void perform(async () => setState(await window.voyager.agents.saveRecording(r.id, recordingName, checks[r.id] ?? {})))}>Save as reusable workflow</button></>}
          </div>}
          <details className="agent-journal"><summary>Activity · {r.usage.steps} steps · {r.usage.inputTokens + r.usage.outputTokens} tokens</summary>
            {r.journal.length ? r.journal.map((j, i) => <p key={i}><span>{j.outcome}</span> {j.label}</p>) : <p>No website actions recorded.</p>}
          </details>
          {!activeAgent(r.status) && <div className="agent-button-row"><button className="agent-text-button" onClick={() => { const d = state.definitions.find((d) => d.id === r.definitionId); if (d) { pick(d); setTask(r.task) } }}>Start again with new access</button>
            <button className="agent-text-button" disabled={busy} onClick={() => void perform(async () => setState(await window.voyager.agents.forget(r.id)))}>Delete run</button></div>}
        </div>}
      </section>)}
      <p className="agent-footnote">Agents use only the tabs you select. Hide this panel whenever you like; the Agents button shows active work and requests for review.</p>
    </div>
  </aside>
}

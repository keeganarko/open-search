import { useEffect, useState, type JSX } from 'react'
import type { Skill, SkillContext } from '@shared/types'
import Panel from './Panel'

const CONTEXT_LABELS: { k: keyof SkillContext; label: string }[] = [
  { k: 'currentPage', label: 'The page I am on' },
  { k: 'selection', label: 'My selection' },
  { k: 'allTabs', label: 'All open tabs' },
  { k: 'history', label: 'My history' },
  { k: 'memory', label: 'What Open Search remembers' },
  { k: 'connectors', label: 'Connectors' }
]

const EMPTY: Partial<Skill> = {
  slug: '', name: '', description: '', prompt: '', hotkey: null, model: null,
  context: { currentPage: true, allTabs: false, selection: false, history: false, memory: true, connectors: false }
}

export default function Skills({ onClose, toast }: {
  onClose: () => void; toast: (m: string, k?: 'info' | 'error') => void
}): JSX.Element {
  const [skills, setSkills] = useState<Skill[]>([])
  const [editing, setEditing] = useState<Partial<Skill> | null>(null)

  useEffect(() => { void window.kia.skills.list().then(setSkills) }, [])

  const save = async (): Promise<void> => {
    if (!editing?.slug || !editing.prompt) return toast('A skill needs a slug and a prompt.', 'error')
    setSkills(await window.kia.skills.save(editing))
    setEditing(null)
  }

  return (
    <Panel
      title="Skills"
      onClose={onClose}
      actions={<button className="btn" onClick={() => setEditing({ ...EMPTY })}>New skill</button>}
    >
      {editing ? (
        <>
          <div className="field">
            <label>Trigger</label>
            <div className="desc">Type <code>/{editing.slug || 'slug'}</code> in the composer.</div>
            <input type="text" value={editing.slug ?? ''} disabled={editing.builtin}
              onChange={(e) => setEditing({
                ...editing, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
              })} />
          </div>
          <div className="field">
            <label>Name</label>
            <input type="text" value={editing.name ?? ''}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Description</label>
            <input type="text" value={editing.description ?? ''}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          </div>
          <div className="field">
            <label>Prompt</label>
            <div className="desc">
              Placeholders: <code>{'{{page}}'}</code> <code>{'{{selection}}'}</code>{' '}
              <code>{'{{tabs}}'}</code> <code>{'{{url}}'}</code> <code>{'{{input}}'}</code>
            </div>
            <textarea rows={10} value={editing.prompt ?? ''}
              onChange={(e) => setEditing({ ...editing, prompt: e.target.value })} />
          </div>
          <div className="field">
            <label>Pull in automatically</label>
            {CONTEXT_LABELS.map(({ k, label }) => (
              <label className="check" key={k}>
                <input type="checkbox" checked={!!editing.context?.[k]}
                  onChange={(e) => setEditing({
                    ...editing,
                    context: { ...(editing.context as SkillContext), [k]: e.target.checked }
                  })} />
                {label}
              </label>
            ))}
          </div>
          <div className="field">
            <label>Hotkey</label>
            <div className="desc">Electron accelerator, e.g. <code>Cmd+Shift+S</code>. Blank for none.</div>
            <input type="text" value={editing.hotkey ?? ''}
              onChange={(e) => setEditing({ ...editing, hotkey: e.target.value || null })} />
          </div>
          <div className="row">
            <button className="btn primary" onClick={save}>Save</button>
            <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          {skills.map((s) => (
            <div className="list-row" key={s.id}>
              <div className="main">
                <div className="t">/{s.slug} — {s.name} {s.builtin && <span className="badge">built in</span>}</div>
                <div className="s">{s.description}</div>
              </div>
              {s.hotkey && <span className="badge">{s.hotkey}</span>}
              <button className="btn" onClick={() => setEditing(s)}>Edit</button>
              {s.builtin
                ? <button className="btn" title="Restore the shipped version"
                    onClick={async () => setSkills(await window.kia.skills.reset(s.slug))}>Reset</button>
                : <button className="btn danger"
                    onClick={async () => setSkills(await window.kia.skills.remove(s.id))}>Delete</button>}
            </div>
          ))}
          {skills.length === 0 && <div className="empty">No skills.</div>}
        </>
      )}
    </Panel>
  )
}

import { describe, it, expect } from 'vitest'
import { browserTools } from '../src/main/agent/tools'
import { requiresApproval } from '../src/main/agent/engine'
import { DEFAULT_SETTINGS } from '../src/main/store/settings'

/** `browserTools` only closes over the window; nothing here calls `run`. */
const win: any = { tabs: { get: () => null }, profile: { id: 'p1' } }
const tools = browserTools(win)
const byName = new Map(tools.map((t) => [t.definition.name, t]))

describe('built-in tools', () => {
  it('gives every tool a name, a class, a description and a runner', () => {
    for (const t of tools) {
      expect(t.definition.name, JSON.stringify(t.definition)).toMatch(/^[a-z_]+$/)
      expect(typeof t.describe).toBe('function')
      expect(typeof t.run).toBe('function')
      expect(t.actionClass).toBeTruthy()
    }
  })

  it('has no duplicate names — the model addresses tools by name alone', () => {
    expect(byName.size).toBe(tools.length)
  })

  it('classifies the page readers as reads', () => {
    for (const n of ['list_tabs', 'read_tab', 'read_current_page', 'read_selection', 'search_history'])
      expect(byName.get(n)?.actionClass, n).toBe('read')
  })

  it('classifies the tab and memory changes as locally reversible', () => {
    for (const n of ['open_tab', 'close_tab', 'group_tabs', 'split_view', 'remember', 'forget', 'bookmark'])
      expect(byName.get(n)?.actionClass, n).toBe('local_reversible')
  })

  it('stops before typing into a page — drafting is not sending', () => {
    // README's promise: `insert_text` writes into a field and never submits, and
    // it is not in the shipped auto-approve list.
    const t = byName.get('insert_text')
    expect(t?.actionClass).toBe('external_draft')
    expect(requiresApproval(t!.actionClass, DEFAULT_SETTINGS.approvals.auto)).toBe(true)
  })

  it('ships nothing that would ask on every call', () => {
    // Nothing built in is `sensitive`; that class is for connector tools.
    expect(tools.some((t) => t.actionClass === 'sensitive')).toBe(false)
  })

  it('auto-approves reads and local changes out of the box, and nothing else', () => {
    const auto = DEFAULT_SETTINGS.approvals.auto
    for (const t of tools) {
      const quiet = !requiresApproval(t.actionClass, auto)
      expect(quiet, t.definition.name).toBe(t.actionClass === 'read' || t.actionClass === 'local_reversible')
    }
  })

  it('describes each tool in a sentence the approval sheet can show', () => {
    for (const t of tools) {
      const line = t.describe({ tabId: 't1', url: 'https://example.com', text: 'x', query: 'q' })
      expect(typeof line, t.definition.name).toBe('string')
      expect(line.length, t.definition.name).toBeGreaterThan(3)
    }
  })
})

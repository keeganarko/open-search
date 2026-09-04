import type Anthropic from '@anthropic-ai/sdk'
import type { KiaWindow } from '../browser/window'
import type { ActionClass } from '@shared/types'
import { readTab, readSelection, renderPage, renderTabList } from './context'
import { prettyHost, resolveInput } from '../browser/urls'
import { getSettings } from '../store/settings'
import * as db from '../store/db'

export interface KiaTool {
  definition: Anthropic.Tool
  actionClass: ActionClass
  /** Short human sentence shown in the approval sheet and the step list. */
  describe: (input: any) => string
  run: (input: any) => Promise<string>
}

const ok = (s: string) => s
const jsonSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object' as const, properties, required, additionalProperties: false
})

export function browserTools(win: KiaWindow): KiaTool[] {
  const tabTitle = (id: string) => win.tabs.get(id)?.state.title ?? id

  return [
    {
      actionClass: 'read',
      describe: () => 'List the open tabs',
      definition: {
        name: 'list_tabs',
        description:
          'List every tab open in the current window with its id, title, host and group. ' +
          'Call this before reading or acting on a tab so you use real ids.',
        input_schema: jsonSchema({})
      },
      run: async () => ok(renderTabList(win))
    },

    {
      actionClass: 'read',
      describe: (i) => `Read “${tabTitle(i.tab_id)}”`,
      definition: {
        name: 'read_tab',
        description:
          'Read the readable text of one open tab (article body, or video transcript when ' +
          'the page is a video). Returns nothing for sites the user has excluded.',
        input_schema: jsonSchema({
          tab_id: { type: 'string', description: 'Tab id from list_tabs' }
        }, ['tab_id'])
      },
      run: async (i) => {
        const page = await readTab(win, String(i.tab_id))
        return page ? renderPage(page) : `No tab with id ${i.tab_id}.`
      }
    },

    {
      actionClass: 'read',
      describe: () => 'Read the current page',
      definition: {
        name: 'read_current_page',
        description: 'Read the readable text of the tab the user is looking at right now.',
        input_schema: jsonSchema({})
      },
      run: async () => {
        const id = win.tabs.activeId
        if (!id) return 'No active tab.'
        const page = await readTab(win, id)
        return page ? renderPage(page) : 'No active tab.'
      }
    },

    {
      actionClass: 'read',
      describe: () => 'Read the selected text',
      definition: {
        name: 'read_selection',
        description: 'Return the text the user currently has selected on the page.',
        input_schema: jsonSchema({})
      },
      run: async () => (await readSelection(win)) || '(nothing selected)'
    },

    {
      actionClass: 'read',
      describe: (i) => `Search history for “${i.query}”`,
      definition: {
        name: 'search_history',
        description:
          'Full-text search the user\'s own browsing history (titles and stored page excerpts). ' +
          'Use this for "that page I read last week"-type questions before searching the web.',
        input_schema: jsonSchema({
          query: { type: 'string' },
          limit: { type: 'number', description: 'Default 20, max 100' }
        }, ['query'])
      },
      run: async (i) => {
        const rows = db.searchHistory(win.profile.id, String(i.query), Math.min(Number(i.limit) || 20, 100))
        if (!rows.length) return 'No matching history.'
        return rows.map((h) =>
          `- ${h.title}\n  ${h.url}\n  visited ${h.visitedAt.slice(0, 16).replace('T', ' ')}` +
          (h.excerpt ? `\n  ${h.excerpt.slice(0, 300)}…` : '')
        ).join('\n')
      }
    },

    {
      actionClass: 'local_reversible',
      describe: (i) => `Open ${prettyHost(String(i.url))}`,
      definition: {
        name: 'open_tab',
        description:
          'Open a URL in a new tab. Opens in the background by default so the user is not ' +
          'yanked away from what they are reading.',
        input_schema: jsonSchema({
          url: { type: 'string' },
          foreground: { type: 'boolean', description: 'Switch to it immediately. Default false.' }
        }, ['url'])
      },
      run: async (i) => {
        const url = resolveInput(String(i.url), getSettings().search.engine)
        const tab = win.tabs.create({ url, background: i.foreground !== true })
        return `Opened ${url} as tab ${tab.id}.`
      }
    },

    {
      actionClass: 'local_reversible',
      describe: (i) => `Close “${tabTitle(i.tab_id)}”`,
      definition: {
        name: 'close_tab',
        description: 'Close one tab by id.',
        input_schema: jsonSchema({ tab_id: { type: 'string' } }, ['tab_id'])
      },
      run: async (i) => {
        const title = tabTitle(String(i.tab_id))
        win.tabs.close(String(i.tab_id))
        return `Closed “${title}”.`
      }
    },

    {
      actionClass: 'local_reversible',
      describe: (i) => `Group ${(i.tab_ids ?? []).length} tabs as “${i.title}”`,
      definition: {
        name: 'group_tabs',
        description:
          'Put a set of tabs into a named group. Creates the group if the name is new. ' +
          'Use this to tidy a window rather than closing anything.',
        input_schema: jsonSchema({
          title: { type: 'string' },
          tab_ids: { type: 'array', items: { type: 'string' } },
          color: { type: 'string', description: 'Hex colour, optional' }
        }, ['title', 'tab_ids'])
      },
      run: async (i) => {
        const title = String(i.title)
        const existing = win.tabs.groups.find((g) => g.title.toLowerCase() === title.toLowerCase())
        const group = existing ?? win.tabs.createGroup(title, String(i.color ?? '#6366f1'))
        const ids = (i.tab_ids as string[]).filter((id) => win.tabs.get(id))
        win.tabs.assign(ids, group.id)
        return `Grouped ${ids.length} tab(s) under “${title}”.`
      }
    },

    {
      actionClass: 'local_reversible',
      describe: (i) => `Show ${(i.tab_ids ?? []).length} tabs side by side`,
      definition: {
        name: 'split_view',
        description: 'Show 2–4 open tabs side by side in the content area.',
        input_schema: jsonSchema({
          tab_ids: { type: 'array', items: { type: 'string' } }
        }, ['tab_ids'])
      },
      run: async (i) => {
        const ids = (i.tab_ids as string[]).filter((id) => win.tabs.get(id)).slice(0, 4)
        if (ids.length < 2) return 'Need at least two valid tab ids for a split.'
        win.setSplit(ids)
        return `Split view showing ${ids.map(tabTitle).join(' | ')}.`
      }
    },

    {
      actionClass: 'local_reversible',
      describe: (i) => `Remember: ${i.text}`,
      definition: {
        name: 'remember',
        description:
          'Store one durable fact or preference about the user so future sessions have it. ' +
          'Write a single, self-contained assertion — not a summary of the conversation. ' +
          'Only store things that will still be useful weeks from now, and only things the ' +
          'user stated or clearly demonstrated. Never store anything from a page the user ' +
          'merely visited, and never store credentials, health, or financial details.',
        input_schema: jsonSchema({
          text: { type: 'string', description: 'One complete assertion, e.g. "Prefers TypeScript over Python for new services."' },
          kind: { type: 'string', enum: ['preference', 'fact', 'project', 'person', 'contact'] },
          expires_at: { type: 'string', description: 'ISO date after which this should be re-checked. Use for anything that can change.' }
        }, ['text', 'kind'])
      },
      run: async (i) => {
        if (!getSettings().privacy.memoryEnabled) return 'Memory is turned off in settings; nothing was stored.'
        const item = db.addMemory(
          win.profile.id, i.kind, String(i.text), 'chat', 0.9,
          i.expires_at ? String(i.expires_at) : null
        )
        return `Remembered: “${item.text}”`
      }
    },

    {
      actionClass: 'local_reversible',
      describe: (i) => `Forget memories matching “${i.query}”`,
      definition: {
        name: 'forget',
        description: 'Delete stored memories matching a phrase. Use when the user says something is wrong or out of date.',
        input_schema: jsonSchema({ query: { type: 'string' } }, ['query'])
      },
      run: async (i) => {
        const q = String(i.query).toLowerCase()
        const hits = db.listMemory(win.profile.id).filter((m) => m.text.toLowerCase().includes(q))
        for (const h of hits) db.deleteMemory(h.id)
        return hits.length ? `Forgot ${hits.length}: ${hits.map((h) => `“${h.text}”`).join(', ')}` : 'Nothing matched.'
      }
    },

    {
      actionClass: 'local_reversible',
      describe: (i) => `Bookmark ${prettyHost(String(i.url))}`,
      definition: {
        name: 'bookmark',
        description: 'Save a page to the user\'s bookmarks.',
        input_schema: jsonSchema({
          url: { type: 'string' }, title: { type: 'string' },
          folder: { type: 'string' }
        }, ['url', 'title'])
      },
      run: async (i) => {
        db.addBookmark(win.profile.id, String(i.url), String(i.title), i.folder ? String(i.folder) : null)
        return `Bookmarked “${i.title}”.`
      }
    },

    {
      actionClass: 'external_draft',
      describe: (i) => `Put draft text into the page field (${String(i.text).length} chars)`,
      definition: {
        name: 'insert_text',
        description:
          'Insert or replace text in the focused editable field on the current page. This only ' +
          'drafts — it never submits a form, clicks a button, or sends anything. The user still ' +
          'has to press send themselves.',
        input_schema: jsonSchema({
          text: { type: 'string' },
          replace_selection: { type: 'boolean', description: 'Replace the current selection rather than inserting at the caret. Default true.' }
        }, ['text'])
      },
      run: async (i) => {
        const tab = win.tabs.active()
        if (!tab) return 'No active tab.'
        const payload = JSON.stringify({ text: String(i.text), replace: i.replace_selection !== false })
        try {
          const res = await tab.view.webContents.executeJavaScript(
            `window.__kia?.insertText?.(${payload}) ?? false`, true
          )
          return res ? 'Inserted the draft into the focused field. Nothing was submitted.'
                     : 'No editable field is focused on the page, so nothing was inserted.'
        } catch {
          return 'The page refused the insertion.'
        }
      }
    }
  ]
}

/** Anthropic-hosted tools. No local execution; results come back inline. */
export function serverTools(): Anthropic.ToolUnion[] {
  return [
    { type: 'web_search_20260209', name: 'web_search', max_uses: 8 } as unknown as Anthropic.ToolUnion,
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 8, citations: { enabled: true } } as unknown as Anthropic.ToolUnion
  ]
}

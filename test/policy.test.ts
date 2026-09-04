import { describe, it, expect } from 'vitest'
import { requiresApproval } from '../src/main/agent/engine'
import { connectorBaseEnv, inferActionClass, validateMcpConfig } from '../src/main/agent/mcp'
import { DEFAULT_SETTINGS, DEFAULT_EXCLUDED, isExcluded, normalizeSettings } from '../src/main/store/settings'
import { isSecureLoginUrl } from '../src/main/browser/passwords'
import type { ActionClass, Settings } from '@shared/types'

const ALL: ActionClass[] = ['read', 'local_reversible', 'external_draft', 'external_write', 'sensitive']

describe('requiresApproval', () => {
  it('never lets a setting auto-approve a sensitive action', () => {
    // The invariant in CLAUDE.md: `sensitive` ignores `auto` entirely.
    expect(requiresApproval('sensitive', ALL)).toBe(true)
    expect(requiresApproval('sensitive', [])).toBe(true)
  })

  it('honours the auto list for everything else', () => {
    expect(requiresApproval('read', ['read'])).toBe(false)
    expect(requiresApproval('read', [])).toBe(true)
    expect(requiresApproval('external_write', ['read', 'local_reversible'])).toBe(true)
  })

  it('ships asking about anything that leaves the machine', () => {
    const auto = DEFAULT_SETTINGS.approvals.auto
    expect(requiresApproval('external_draft', auto)).toBe(true)
    expect(requiresApproval('external_write', auto)).toBe(true)
    expect(requiresApproval('read', auto)).toBe(false)
  })
})

describe('inferActionClass', () => {
  it('calls money, deletion and credentials sensitive', () => {
    for (const n of [
      'create_payment', 'delete_issue', 'transfer_funds', 'revoke_token',
      'reset_password', 'deploy_service', 'force-push'
    ]) expect(inferActionClass(n), n).toBe('sensitive')
  })

  it('sorts drafting below sending', () => {
    expect(inferActionClass('draft_email')).toBe('external_draft')
    expect(inferActionClass('send_email')).toBe('external_write')
  })

  it('recognises retrieval', () => {
    for (const n of ['search_issues', 'get_page', 'list_repos', 'fetch_thread'])
      expect(inferActionClass(n), n).toBe('read')
  })

  it('reads the description, not just the name', () => {
    expect(inferActionClass('do_thing', 'Deletes the record permanently')).toBe('sensitive')
  })

  it('assumes the worst for a tool it cannot place', () => {
    expect(inferActionClass('frobnicate', 'wibbles the wobble')).toBe('external_write')
  })

  it('takes the most dangerous reading when signals collide', () => {
    // "search and delete" must not land on `read` just because it says search.
    expect(inferActionClass('search_and_delete_messages')).toBe('sensitive')
  })
})

describe('isExcluded', () => {
  const settings = { ...DEFAULT_SETTINGS } as Settings

  it('fails closed on anything it cannot parse', () => {
    for (const u of ['', 'not a url', 'about:blank%%'])
      expect(isExcluded(u, settings), u).toBe(true)
  })

  it('covers the institutions the old three-entry list let through', () => {
    for (const u of [
      'https://www.chase.com/', 'https://client.schwab.com/app',
      'https://digital.fidelity.com/x', 'https://www.coinbase.com/'
    ]) expect(isExcluded(u, settings), u).toBe(true)
  })

  it('matches on substring, so subdomains and suffixes are covered', () => {
    expect(isExcluded('https://secure.bankofamerica.com/login', settings)).toBe(true)
    expect(isExcluded('https://mail.google.com/mail/u/0', settings)).toBe(true)
  })

  it('leaves ordinary sites readable', () => {
    for (const u of ['https://example.com', 'https://news.ycombinator.com', 'https://github.com/x'])
      expect(isExcluded(u, settings), u).toBe(false)
  })

  it('ignores blank entries in a hand-edited list', () => {
    const custom = { ...settings, privacy: { ...settings.privacy, excludedDomains: ['', '  '] } }
    expect(isExcluded('https://example.com', custom)).toBe(false)
  })

  it('honours a user-typed domain case-insensitively', () => {
    const custom = { ...settings, privacy: { ...settings.privacy, excludedDomains: ['Example.COM'] } }
    expect(isExcluded('https://www.example.com/a', custom)).toBe(true)
  })

  it('has a default list with no empty entries', () => {
    expect(DEFAULT_EXCLUDED.every((d) => d.trim().length > 2)).toBe(true)
  })
})

describe('inferActionClass — words that only look like verbs', () => {
  it('does not read "address" as "add"', () => {
    expect(inferActionClass('get_address', 'Returns the mailing address')).toBe('read')
  })
  it('does not read "budget" as "get"', () => {
    // \b still applies before the stem, so only a real word start counts.
    expect(inferActionClass('budget_report', 'Produces the quarterly budget report'))
      .toBe('external_write')
  })
  it('still catches the real ones', () => {
    expect(inferActionClass('addComment')).toBe('external_write')
    expect(inferActionClass('set_status')).toBe('external_write')
    expect(inferActionClass('cancel_subscription')).toBe('sensitive')
  })
})

describe('connectorBaseEnv', () => {
  it('keeps process essentials and strips inherited credentials', () => {
    expect(connectorBaseEnv({
      PATH: '/bin', HOME: '/home/alice', LANG: 'en_US.UTF-8',
      ANTHROPIC_API_KEY: 'secret', AWS_SECRET_ACCESS_KEY: 'secret',
      CUSTOM_CONNECTOR_TOKEN: 'secret'
    })).toEqual({ PATH: '/bin', HOME: '/home/alice', LANG: 'en_US.UTF-8' })
  })

  it('keeps Windows command resolution variables', () => {
    expect(connectorBaseEnv({
      Path: 'C:\\Windows', PATHEXT: '.EXE;.CMD', SystemRoot: 'C:\\Windows',
      COMSPEC: 'C:\\Windows\\System32\\cmd.exe'
    })).toEqual({
      Path: 'C:\\Windows', PATHEXT: '.EXE;.CMD', SystemRoot: 'C:\\Windows',
      COMSPEC: 'C:\\Windows\\System32\\cmd.exe'
    })
  })
})

describe('connector configuration', () => {
  it('requires encryption in transit for hosted connectors', () => {
    expect(() => validateMcpConfig({
      id: 'x', name: 'Remote', enabled: true, transport: 'http',
      url: 'http://example.com/mcp', headers: {}
    })).toThrow(/HTTPS/)
    expect(() => validateMcpConfig({
      id: 'x', name: 'Local', enabled: true, transport: 'http',
      url: 'http://127.0.0.1:8787/mcp', headers: {}
    })).toThrow(/public HTTPS/)
  })

  it('rejects malformed local process configuration', () => {
    expect(() => validateMcpConfig({
      id: 'x', name: 'Bad', enabled: false, transport: 'stdio',
      command: 'tool\nsecond-command', args: [], env: {}
    })).toThrow(/command/)
    expect(() => validateMcpConfig({
      id: 'x', name: 'Bad env', enabled: false, transport: 'stdio',
      command: 'tool', args: [], env: { 'NOT VALID': 'x' }
    })).toThrow(/environment/)
  })
})

describe('settings normalization', () => {
  it('clamps numbers, strips unknown choices, and bounds imported lists', () => {
    const normalized = normalizeSettings({
      ai: { effort: 'unlimited', showThinking: 'yes' },
      privacy: {
        historyRetentionDays: 999_999,
        excludedDomains: [...Array.from({ length: 600 }, (_, i) => `SITE${i}.TEST`), '']
      },
      appearance: { theme: 'neon', startupVolume: -10 },
      approvals: { auto: ['read', 'sensitive', 'made_up'] }
    })
    expect(normalized.ai.effort).toBe(DEFAULT_SETTINGS.ai.effort)
    expect(normalized.ai.showThinking).toBe(DEFAULT_SETTINGS.ai.showThinking)
    expect(normalized.privacy.historyRetentionDays).toBe(3_650)
    expect(normalized.privacy.excludedDomains).toHaveLength(500)
    expect(normalized.privacy.excludedDomains[0]).toBe('site0.test')
    expect(normalized.appearance.theme).toBe(DEFAULT_SETTINGS.appearance.theme)
    expect(normalized.appearance.startupVolume).toBe(0)
    expect(normalized.approvals.auto).toEqual(['read'])
  })
})

describe('saved-login transport policy', () => {
  it('allows HTTPS and local development without filling remote plaintext HTTP', () => {
    expect(isSecureLoginUrl('https://example.com/login')).toBe(true)
    expect(isSecureLoginUrl('http://localhost:3000/login')).toBe(true)
    expect(isSecureLoginUrl('http://127.0.0.1:8080/login')).toBe(true)
    expect(isSecureLoginUrl('http://example.com/login')).toBe(false)
  })
})

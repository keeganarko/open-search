import { safeStorage } from 'electron'
import { kvGet, kvSet } from './db'
import type { Settings } from '@shared/types'

const KEY = 'settings'
const API_KEY = 'anthropic_api_key_enc'

/**
 * Matched as a substring of the hostname, so `bank` also covers usbank.com and
 * bankofamerica.com. Over-matching is the safe direction here: the cost of an
 * extra excluded site is that Voyager cannot read it, and the cost of a miss is a
 * bank statement in a model's context window.
 *
 * The old default was `['mail.google.com', 'bank', 'accounts.google.com']`,
 * which caught almost no real institution — chase.com, schwab.com and fidelity
 * .com all sailed straight through it.
 */
export const DEFAULT_EXCLUDED = [
  // mail and identity
  'mail.google.com', 'accounts.google.com', 'outlook.office.com', 'outlook.live.com',
  'mail.yahoo.com', 'id.me', 'login.microsoftonline.com', 'okta.com', 'duosecurity.com',
  // password managers
  '1password.com', 'lastpass.com', 'bitwarden.com', 'dashlane.com', 'keepersecurity.com',
  // banks and card issuers
  'bank', 'chase.com', 'wellsfargo.com', 'citi.com', 'citibank.com', 'capitalone.com',
  'discover.com', 'amex.com', 'americanexpress.com', 'pnc.com', 'truist.com',
  'usaa.com', 'ally.com', 'sofi.com', 'navyfederal.org', 'schwab.com',
  'tdbank.com', 'regions.com', 'fifththird.com', 'citizensbank.com', 'huntington.com',
  'creditunion', 'santander', 'hsbc.', 'barclays', 'natwest', 'lloydsbank', 'monzo.com',
  // brokerages and crypto
  'fidelity.com', 'vanguard.com', 'etrade.com', 'robinhood.com', 'tdameritrade.com',
  'interactivebrokers.com', 'merrilledge.com', 'coinbase.com', 'kraken.com', 'gemini.com',
  // payments and payroll
  'paypal.com', 'venmo.com', 'wise.com', 'cash.app', 'stripe.com', 'waveapps.com',
  'gusto.com', 'adp.com', 'workday.com',
  // government and health
  'irs.gov', 'ssa.gov', 'login.gov', 'healthcare.gov', 'mychart', 'myuhc.com'
]

export const DEFAULT_SETTINGS: Settings = {
  ai: {
    provider: 'anthropic',
    model: 'claude-opus-5',
    apiKey: null,
    effort: 'high',
    showThinking: true,
    contextConsent: false
  },
  privacy: {
    blockAds: true,
    blockTrackers: true,
    excludedDomains: DEFAULT_EXCLUDED,
    historyRetentionDays: 90,
    memoryEnabled: true,
    paused: false,
    sendDoNotTrack: true,
    clearOnQuit: false
  },
  appearance: {
    theme: 'system', accent: '#6366f1', compactChrome: false,
    startupSound: true, startupStory: true, startupVolume: 0.7
  },
  search: { engine: 'google', askFirst: true },
  brief: {
    enabled: true, at: '08:00', includeCalendar: true,
    includeMail: true, includeTabs: true, includeReadingList: true
  },
  approvals: { auto: ['read', 'local_reversible'] },
  sync: { folder: null, passphraseSet: false, lastExportAt: null }
}

function merge(base: Settings, patch: any): Settings {
  const out: any = { ...base }
  for (const k of Object.keys(base) as (keyof Settings)[]) {
    out[k] = { ...(base[k] as object), ...(patch?.[k] ?? {}) }
  }
  return out as Settings
}

const record = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
const boolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback
const string = (value: unknown, fallback: string, max = 1_000): string =>
  typeof value === 'string' && !value.includes('\0') ? value.slice(0, max) : fallback
const choice = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
const finiteNumber = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback

/** Strip unknown fields and repair malformed persisted/imported settings. */
export function normalizeSettings(value: unknown): Settings {
  const root = record(value)
  const ai = record(root.ai)
  const privacy = record(root.privacy)
  const appearance = record(root.appearance)
  const search = record(root.search)
  const brief = record(root.brief)
  const approvals = record(root.approvals)
  const sync = record(root.sync)
  const domains = Array.isArray(privacy.excludedDomains)
    ? [...new Set(privacy.excludedDomains
      .filter((item: unknown): item is string => typeof item === 'string')
      .map((item: string) => item.trim().toLowerCase().slice(0, 255))
      .filter(Boolean))].slice(0, 500)
    : DEFAULT_SETTINGS.privacy.excludedDomains
  const actionClasses = ['read', 'local_reversible', 'external_draft', 'external_write'] as const

  return {
    ai: {
      provider: 'anthropic',
      model: string(ai.model, DEFAULT_SETTINGS.ai.model, 200),
      apiKey: typeof ai.apiKey === 'string' ? ai.apiKey.slice(0, 10_000) : null,
      effort: choice(ai.effort, ['low', 'medium', 'high', 'xhigh', 'max'], DEFAULT_SETTINGS.ai.effort),
      showThinking: boolean(ai.showThinking, DEFAULT_SETTINGS.ai.showThinking),
      contextConsent: boolean(ai.contextConsent, DEFAULT_SETTINGS.ai.contextConsent)
    },
    privacy: {
      blockAds: boolean(privacy.blockAds, DEFAULT_SETTINGS.privacy.blockAds),
      blockTrackers: boolean(privacy.blockTrackers, DEFAULT_SETTINGS.privacy.blockTrackers),
      excludedDomains: domains,
      historyRetentionDays: Math.round(finiteNumber(
        privacy.historyRetentionDays, DEFAULT_SETTINGS.privacy.historyRetentionDays, 1, 3_650
      )),
      memoryEnabled: boolean(privacy.memoryEnabled, DEFAULT_SETTINGS.privacy.memoryEnabled),
      paused: boolean(privacy.paused, DEFAULT_SETTINGS.privacy.paused),
      sendDoNotTrack: boolean(privacy.sendDoNotTrack, DEFAULT_SETTINGS.privacy.sendDoNotTrack),
      clearOnQuit: boolean(privacy.clearOnQuit, DEFAULT_SETTINGS.privacy.clearOnQuit)
    },
    appearance: {
      theme: choice(appearance.theme, ['system', 'light', 'dark'], DEFAULT_SETTINGS.appearance.theme),
      accent: typeof appearance.accent === 'string' && /^#[0-9a-f]{6}$/i.test(appearance.accent)
        ? appearance.accent : DEFAULT_SETTINGS.appearance.accent,
      compactChrome: boolean(appearance.compactChrome, DEFAULT_SETTINGS.appearance.compactChrome),
      startupSound: boolean(appearance.startupSound, DEFAULT_SETTINGS.appearance.startupSound),
      startupStory: boolean(appearance.startupStory, DEFAULT_SETTINGS.appearance.startupStory),
      startupVolume: finiteNumber(appearance.startupVolume, DEFAULT_SETTINGS.appearance.startupVolume, 0, 1)
    },
    search: {
      engine: choice(search.engine, ['google', 'duckduckgo', 'brave', 'kagi'], DEFAULT_SETTINGS.search.engine),
      askFirst: boolean(search.askFirst, DEFAULT_SETTINGS.search.askFirst)
    },
    brief: {
      enabled: boolean(brief.enabled, DEFAULT_SETTINGS.brief.enabled),
      at: typeof brief.at === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(brief.at)
        ? brief.at : DEFAULT_SETTINGS.brief.at,
      includeCalendar: boolean(brief.includeCalendar, DEFAULT_SETTINGS.brief.includeCalendar),
      includeMail: boolean(brief.includeMail, DEFAULT_SETTINGS.brief.includeMail),
      includeTabs: boolean(brief.includeTabs, DEFAULT_SETTINGS.brief.includeTabs),
      includeReadingList: boolean(brief.includeReadingList, DEFAULT_SETTINGS.brief.includeReadingList)
    },
    approvals: {
      auto: Array.isArray(approvals.auto)
        ? [...new Set(approvals.auto.filter((item: unknown) =>
          typeof item === 'string' && actionClasses.includes(item as typeof actionClasses[number])
        ))] as Settings['approvals']['auto']
        : DEFAULT_SETTINGS.approvals.auto
    },
    sync: {
      folder: typeof sync.folder === 'string' ? sync.folder.slice(0, 4_096) : null,
      passphraseSet: boolean(sync.passphraseSet, DEFAULT_SETTINGS.sync.passphraseSet),
      lastExportAt: typeof sync.lastExportAt === 'string' ? sync.lastExportAt.slice(0, 100) : null
    }
  }
}

/**
 * The shipped exclusion list before 2026-09-04. An install that still carries it
 * verbatim never chose it — it was simply the default at the time — and it let
 * every real bank through, so it is replaced rather than preserved. A list the
 * user has actually edited is left alone.
 */
const LEGACY_EXCLUDED = ['mail.google.com', 'bank', 'accounts.google.com']

function upgradeExclusions(stored: Partial<Settings>): Partial<Settings> {
  const list = stored.privacy?.excludedDomains
  if (!list || list.length !== LEGACY_EXCLUDED.length) return stored
  if (!LEGACY_EXCLUDED.every((d) => list.includes(d))) return stored
  const next = { ...stored, privacy: { ...stored.privacy!, excludedDomains: DEFAULT_EXCLUDED } }
  kvSet(KEY, next)
  return next
}

export function getSettings(): Settings {
  const stored = upgradeExclusions(kvGet<Partial<Settings>>(KEY, {}))
  const s = normalizeSettings(stored)
  // The key never lives in the settings blob — it goes through safeStorage.
  s.ai.apiKey = getApiKey()
  return s
}

export function setSettings(patch: Partial<Settings>): Settings {
  const current = normalizeSettings(kvGet<Partial<Settings>>(KEY, {}))
  const merged = normalizeSettings(merge(current, patch))
  const apiKeyWasPatched = !!patch.ai && Object.hasOwn(patch.ai, 'apiKey')
  const apiKey = merged.ai.apiKey
  // Strip the key before persisting the plaintext settings blob.
  const toStore: any = { ...merged, ai: { ...merged.ai, apiKey: null } }
  kvSet(KEY, toStore)
  if (apiKeyWasPatched) {
    if (typeof apiKey === 'string' && apiKey.length) setApiKey(apiKey)
    else clearApiKey()
  }
  return getSettings()
}

/** Key at rest is encrypted with the OS credential store, never plaintext. */
export function setApiKey(key: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Secure credential storage is unavailable. Voyager refused to save the API key; ' +
      'configure the operating system keychain/credential store and try again.'
    )
  }
  kvSet(API_KEY, safeStorage.encryptString(key).toString('base64'))
}

export function getApiKey(): string | null {
  const stored = kvGet<string | null>(API_KEY, null)
  if (!stored) return process.env.ANTHROPIC_API_KEY ?? null
  // Migrate a key written by an older build. If encryption is unavailable,
  // purge the plaintext rather than continuing to treat SQLite as a vault.
  if (stored.startsWith('plain:')) {
    const legacy = stored.slice(6)
    if (safeStorage.isEncryptionAvailable()) {
      setApiKey(legacy)
      return legacy
    }
    kvSet(API_KEY, null)
    return process.env.ANTHROPIC_API_KEY ?? null
  }
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return process.env.ANTHROPIC_API_KEY ?? null
  }
}

export function clearApiKey(): void {
  kvSet(API_KEY, null)
}

/** A domain the user has excluded is never read, stored, or sent to a model. */
export function isExcluded(url: string, settings = getSettings()): boolean {
  if (!url) return true
  let host: string
  try { host = new URL(url).hostname } catch { return true }
  // `file:`, `data:` and `about:` parse cleanly and carry no host, so no entry
  // in the list can ever match one. Treat them as excluded rather than as
  // universally readable.
  if (!host) return true
  return settings.privacy.excludedDomains.some((d) => {
    const needle = d.trim().toLowerCase()
    if (!needle) return false
    return host.toLowerCase().includes(needle)
  })
}

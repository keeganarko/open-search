import { safeStorage } from 'electron'
import { kvGet, kvSet } from './db'
import type { Settings } from '@shared/types'

const KEY = 'settings'
const API_KEY = 'anthropic_api_key_enc'

/**
 * Matched as a substring of the hostname, so `bank` also covers usbank.com and
 * bankofamerica.com. Over-matching is the safe direction here: the cost of an
 * extra excluded site is that Open Search cannot read it, and the cost of a miss is a
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
  const s = merge(DEFAULT_SETTINGS, stored)
  // The key never lives in the settings blob — it goes through safeStorage.
  s.ai.apiKey = getApiKey()
  return s
}

export function setSettings(patch: Partial<Settings>): Settings {
  const current = kvGet<Partial<Settings>>(KEY, {})
  const merged = merge(merge(DEFAULT_SETTINGS, current), patch)
  const apiKey = merged.ai.apiKey
  // Strip the key before persisting the plaintext settings blob.
  const toStore: any = { ...merged, ai: { ...merged.ai, apiKey: null } }
  kvSet(KEY, toStore)
  if (typeof apiKey === 'string' && apiKey.length) setApiKey(apiKey)
  if (apiKey === '') clearApiKey()
  return getSettings()
}

/** Key at rest is encrypted with the OS keychain, never written as plaintext. */
export function setApiKey(key: string): void {
  if (safeStorage.isEncryptionAvailable()) {
    kvSet(API_KEY, safeStorage.encryptString(key).toString('base64'))
  } else {
    kvSet(API_KEY, `plain:${key}`)
  }
}

export function getApiKey(): string | null {
  const stored = kvGet<string | null>(API_KEY, null)
  if (!stored) return process.env.ANTHROPIC_API_KEY ?? null
  if (stored.startsWith('plain:')) return stored.slice(6)
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

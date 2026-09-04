import { app } from 'electron'
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

export const THREAT_FEED = 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/tif.medium-onlydomains.txt'
const MAX_BYTES = 24 * 1024 * 1024
const MAX_AGE = 7 * 86400_000
let domains = new Set<string>()
let updatedAt = 0
let refreshing = false
let failure = ''

export function parseThreatList(text: string): Set<string> {
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Threat list too large.')
  const entries = new Set<string>()
  for (const line of text.split('\n')) {
    const host = line.trim().toLowerCase()
    if (!host || host.startsWith('#') || host.startsWith('!')) continue
    // Domain-only data, never filter scripts, URLs, redirect rules or executable code.
    if (host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(host)) {
      throw new Error('Malformed threat list.')
    }
    entries.add(host)
    if (entries.size > 750_000) throw new Error('Too many threat domains.')
  }
  if (entries.size < 1000) throw new Error('Threat list is incomplete.')
  return entries
}

function listDate(text: string): number {
  const raw = /^# Last modified: (.+)$/m.exec(text)?.[1]
  const date = Date.parse(raw ?? '')
  if (!Number.isFinite(date) || date > Date.now() + 5 * 60_000) throw new Error('Invalid threat-list date.')
  return date
}

export function matchesThreat(url: string, list = domains): boolean {
  try {
    let host = new URL(url).hostname.toLowerCase().replace(/\.$/, '')
    while (host.includes('.')) {
      if (list.has(host)) return true
      host = host.slice(host.indexOf('.') + 1)
    }
  } catch { /* Internal/invalid addresses have no DNS threat match. */ }
  return false
}

export function threatStatus(): { domains: number; updatedAt: string | null; stale: boolean; error: string } {
  return { domains: domains.size, updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
    stale: !updatedAt || Date.now() - updatedAt > MAX_AGE, error: failure }
}

export async function initializeThreats(refresh = true): Promise<void> {
  const bundled = join(app.getAppPath(), 'resources/security/threat-domains.txt')
  const cached = join(app.getPath('userData'), 'security/threat-domains.txt')
  for (const file of [bundled, cached]) {
    try {
      const meta = await stat(file)
      if (meta.size > MAX_BYTES) continue
      const text = await readFile(file, 'utf8')
      const list = parseThreatList(text)
      const date = listDate(text)
      if (date >= updatedAt) { domains = list; updatedAt = date }
    } catch { /* A valid bundled list remains active if a cache is corrupt. */ }
  }
  if (!domains.size) failure = 'The threat list could not be loaded. Known-threat protection is unavailable.'
  // Start with the bundled list before any browsing sessions are created.
  if (refresh) {
    void refreshThreats()
    setInterval(() => void refreshThreats(), 4 * 3600_000).unref()
  }
}

export async function refreshThreats(): Promise<void> {
  if (refreshing) return
  refreshing = true
  try {
    const response = await fetch(THREAT_FEED, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30_000) })
    if (!response.ok || !response.body) throw new Error('Threat feed unavailable.')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > MAX_BYTES) { await reader.cancel(); throw new Error('Threat list too large.') }
      chunks.push(value)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    const next = parseThreatList(text)
    const date = listDate(text)
    if (date < updatedAt) throw new Error('Threat feed moved backwards.')
    const directory = join(app.getPath('userData'), 'security')
    await mkdir(directory, { recursive: true })
    const file = join(directory, 'threat-domains.txt')
    await writeFile(`${file}.tmp`, text, { mode: 0o600 })
    await rename(`${file}.tmp`, file)
    domains = next
    updatedAt = date
    failure = ''
  } catch {
    failure = 'Threat-list refresh failed; the last valid list remains active.'
  } finally { refreshing = false }
}

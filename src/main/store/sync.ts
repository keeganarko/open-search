import { randomBytes, scryptSync, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import * as db from './db'
import { getSettings, setSettings } from './settings'
import { mcp } from '../agent/mcp'
import { validateMcpConfig } from '../agent/mcp'
import { z } from 'zod'

const shortText = z.string().max(1_000)
const date = z.string().max(100)
const skillSchema = z.object({
  id: shortText, slug: z.string().regex(/^[a-z0-9-]{1,100}$/), name: shortText,
  description: z.string().max(10_000), prompt: z.string().max(100_000),
  context: z.object({ currentPage: z.boolean(), allTabs: z.boolean(), selection: z.boolean(),
    history: z.boolean(), memory: z.boolean(), connectors: z.boolean() }),
  model: shortText.nullable(), builtin: z.boolean(), hotkey: shortText.nullable(),
  createdAt: date, updatedAt: date
})
const memorySchema = z.object({
  kind: z.enum(['preference', 'fact', 'project', 'person', 'contact']), text: z.string().max(20_000),
  source: shortText.optional(), confidence: z.number().min(0).max(1).optional(), expiresAt: date.nullable().optional()
})
const bookmarkSchema = z.object({
  url: z.string().max(8_192).url().refine((s) => /^https?:/.test(s)),
  title: shortText, folder: shortText.nullable().optional()
})

const MAGIC = 'VOYAGER-SYNC-1'
const FILENAME = 'voyager-sync.enc'
const MAX_BUNDLE_BYTES = 25 * 1024 * 1024

interface Bundle {
  version: 1
  exportedAt: string
  settings: unknown
  skills: unknown[]
  memory: unknown[]
  bookmarks: unknown[]
  mcpServers: unknown[]
  profiles: unknown[]
}

/**
 * scrypt with a per-file salt, then AES-256-GCM. The passphrase never leaves
 * this machine and is never stored; losing it means losing the bundle.
 */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 })
}

export function encryptBundle(bundle: Bundle, passphrase: string): Buffer {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = deriveKey(passphrase, salt)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(bundle), 'utf8')
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  const header = Buffer.from(MAGIC, 'utf8')
  return Buffer.concat([header, salt, iv, tag, body])
}

export function decryptBundle(buf: Buffer, passphrase: string): Bundle {
  if (buf.length > MAX_BUNDLE_BYTES) throw new Error('That sync bundle is too large to import safely.')
  // Length first: `timingSafeEqual` throws on a size mismatch, and a truncated
  // file should read as "not a bundle" rather than as a crash.
  const header = buf.subarray(0, MAGIC.length)
  if (header.length !== MAGIC.length || !timingSafeEqual(header, Buffer.from(MAGIC, 'utf8'))) {
    throw new Error('That file is not a Voyager sync bundle.')
  }
  if (buf.length < MAGIC.length + 16 + 12 + 16 + 2) {
    throw new Error('That file is not a complete Voyager sync bundle.')
  }
  let o = MAGIC.length
  const salt = buf.subarray(o, o += 16)
  const iv = buf.subarray(o, o += 12)
  const tag = buf.subarray(o, o += 16)
  const body = buf.subarray(o)
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv)
  decipher.setAuthTag(tag)
  try {
    const plain = Buffer.concat([decipher.update(body), decipher.final()])
    const parsed = JSON.parse(plain.toString('utf8')) as Bundle
    if (!parsed || parsed.version !== 1 || typeof parsed.exportedAt !== 'string') {
      throw new Error('Unsupported bundle format.')
    }
    for (const [key, max] of [
      ['skills', 1_000], ['memory', 10_000], ['bookmarks', 10_000],
      ['mcpServers', 100], ['profiles', 100]
    ] as const) {
      if (!Array.isArray(parsed[key]) || parsed[key].length > max) {
        throw new Error(`Invalid or oversized ${key} list.`)
      }
    }
    return parsed
  } catch {
    throw new Error('Wrong passphrase, or the file has been modified.')
  }
}

function collect(profileId: string): Bundle {
  const settings = getSettings()
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    // The API key is deliberately excluded — it is machine-local.
    settings: { appearance: settings.appearance, search: settings.search },
    skills: db.listSkills(),
    memory: db.listMemory(profileId),
    bookmarks: db.listBookmarks(profileId),
    mcpServers: mcp.configs().filter((c) => c.profileId === profileId)
      .map((c) => ({ ...c, enabled: false, env: {}, headers: {} })),
    profiles: db.listProfiles()
  }
}

export async function exportSync(profileId: string, folder: string, passphrase: string): Promise<string> {
  const bundle = collect(profileId)
  const buf = encryptBundle(bundle, passphrase)
  const path = join(folder, FILENAME)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, buf)
  setSettings({ sync: { folder, passphraseSet: true, lastExportAt: bundle.exportedAt } } as any)
  return path
}

export interface ImportSummary {
  skills: number; memory: number; bookmarks: number; connectors: number; settings: boolean
}

export async function importSync(
  profileId: string, path: string, passphrase: string
): Promise<ImportSummary> {
  const info = await stat(path)
  if (info.size > MAX_BUNDLE_BYTES) throw new Error('That sync bundle is too large to import safely.')
  const buf = await readFile(path)
  const bundle = decryptBundle(buf, passphrase)
  const summary: ImportSummary = { skills: 0, memory: 0, bookmarks: 0, connectors: 0, settings: false }

  // Validate every record before the first mutation. An encrypted file is not
  // necessarily trustworthy: another machine or its passphrase can be compromised.
  const skills = bundle.skills.map((s) => skillSchema.parse(s))
  const memory = bundle.memory.map((m) => memorySchema.parse(m))
  const bookmarks = bundle.bookmarks.map((b) => bookmarkSchema.parse(b))
  const connectors = bundle.mcpServers.map((c: any) => validateMcpConfig({
    ...c, enabled: false, env: {}, headers: {}
  }))

  if (bundle.settings) {
    const imported = bundle.settings as any
    // Consent, exclusions, approvals, background AI, and secrets are machine-local.
    const incoming: any = { appearance: imported.appearance, search: imported.search }
    setSettings(incoming)
    summary.settings = true
  }

  for (const s of skills) {
    db.upsertSkill({ ...s, updatedAt: new Date().toISOString() })
    summary.skills++
  }
  for (const m of memory) {
    db.addMemory(profileId, m.kind, m.text, m.source ?? 'sync', m.confidence ?? 0.8, m.expiresAt ?? null)
    summary.memory++
  }
  for (const b of bookmarks) {
    db.addBookmark(profileId, b.url, b.title, b.folder ?? null)
    summary.bookmarks++
  }
  for (const c of connectors) {
    // Importing data must never launch a program. The user can inspect and
    // explicitly enable a restored local connector afterward.
    await mcp.save({ ...c, id: `import-${randomBytes(16).toString('hex')}`, profileId, enabled: false })
    summary.connectors++
  }
  return summary
}

export const SYNC_FILENAME = FILENAME

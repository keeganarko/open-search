import { randomBytes, scryptSync, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import * as db from './db'
import { getSettings, setSettings } from './settings'
import { mcp } from '../agent/mcp'

const MAGIC = 'KIA-SYNC-1'
const FILENAME = 'kia-sync.enc'

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
  // Length first: `timingSafeEqual` throws on a size mismatch, and a truncated
  // file should read as "not a bundle" rather than as a crash.
  const header = buf.subarray(0, MAGIC.length)
  if (header.length !== MAGIC.length || !timingSafeEqual(header, Buffer.from(MAGIC, 'utf8'))) {
    throw new Error('That file is not an Open Search sync bundle.')
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
    return JSON.parse(plain.toString('utf8')) as Bundle
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
    settings: { ...settings, ai: { ...settings.ai, apiKey: null } },
    skills: db.listSkills(),
    memory: db.listMemory(profileId),
    bookmarks: db.listBookmarks(profileId),
    mcpServers: mcp.configs(),
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
  const buf = await readFile(path)
  const bundle = decryptBundle(buf, passphrase)
  const summary: ImportSummary = { skills: 0, memory: 0, bookmarks: 0, connectors: 0, settings: false }

  if (bundle.settings) {
    const incoming: any = { ...(bundle.settings as any) }
    // Never let an imported bundle overwrite this machine's key or sync target.
    delete incoming.ai?.apiKey
    delete incoming.sync
    setSettings(incoming)
    summary.settings = true
  }

  for (const s of (bundle.skills ?? []) as any[]) {
    db.upsertSkill({ ...s, updatedAt: new Date().toISOString() })
    summary.skills++
  }
  for (const m of (bundle.memory ?? []) as any[]) {
    db.addMemory(profileId, m.kind, m.text, m.source ?? 'sync', m.confidence ?? 0.8, m.expiresAt ?? null)
    summary.memory++
  }
  for (const b of (bundle.bookmarks ?? []) as any[]) {
    db.addBookmark(profileId, b.url, b.title, b.folder ?? null)
    summary.bookmarks++
  }
  for (const c of (bundle.mcpServers ?? []) as any[]) {
    await mcp.save(c)
    summary.connectors++
  }
  return summary
}

export const SYNC_FILENAME = FILENAME

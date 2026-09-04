import { session, type Extension } from 'electron'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { kvGet, kvSet } from '../store/db'
import type { ExtensionStatus } from '@shared/types'

const KEY = 'extensions'

/** What is persisted. `ExtensionStatus` is this plus live load state. */
type ExtensionRecord = Omit<ExtensionStatus, 'loaded' | 'error'>

/** Loaded ids per partition, so a toggle can find the right thing to remove. */
const loaded = new Map<string, Map<string, Extension>>()

function records(): ExtensionRecord[] {
  return kvGet<ExtensionRecord[]>(KEY, [])
}
function save(list: ExtensionRecord[]): void {
  kvSet(KEY, list)
}

/**
 * Chrome extensions ship a `manifest.json` at the directory root; anything else
 * is not an extension, however much it looks like one.
 */
export function readManifest(dir: string): { name: string; version: string; manifestVersion: number } {
  const file = join(dir, 'manifest.json')
  if (!existsSync(file)) throw new Error('No manifest.json in that folder.')
  const m = JSON.parse(readFileSync(file, 'utf8')) as {
    name?: string; version?: string; manifest_version?: number
  }
  if (!m.name) throw new Error('That manifest has no name.')
  return {
    name: m.name,
    version: m.version ?? '0',
    manifestVersion: m.manifest_version ?? 2
  }
}

/**
 * Electron implements a subset of the extension APIs — enough for content
 * scripts, `chrome.storage`, `declarativeNetRequest` and most of `chrome.tabs`,
 * but there is no browser action popup surface and no `chrome.webRequest`
 * blocking. An extension that leans on those loads and then quietly does
 * nothing, which is why the panel says so rather than implying parity.
 */
export async function loadInto(partition: string): Promise<void> {
  const ses = session.fromPartition(partition)
  const map = loaded.get(partition) ?? new Map<string, Extension>()
  loaded.set(partition, map)
  for (const r of records()) {
    if (!r.enabled || map.has(r.path)) continue
    try {
      const ext = await ses.extensions.loadExtension(r.path, { allowFileAccess: false })
      map.set(r.path, ext)
    } catch (err) {
      console.error('[kia] extension failed to load:', r.path, err)
    }
  }
}

/** Every partition that has ever been asked to load extensions. */
function partitions(): string[] {
  return [...loaded.keys()]
}

export async function add(dir: string): Promise<ExtensionStatus[]> {
  const meta = readManifest(dir)
  const list = records().filter((r) => r.path !== dir)
  list.push({ ...meta, path: dir, enabled: true, addedAt: new Date().toISOString() })
  save(list)
  for (const p of partitions()) await loadInto(p)
  return status()
}

export async function remove(path: string): Promise<ExtensionStatus[]> {
  save(records().filter((r) => r.path !== path))
  for (const [partition, map] of loaded) {
    const ext = map.get(path)
    if (!ext) continue
    try { session.fromPartition(partition).extensions.removeExtension(ext.id) } catch { /* gone */ }
    map.delete(path)
  }
  return status()
}

export async function toggle(path: string, enabled: boolean): Promise<ExtensionStatus[]> {
  save(records().map((r) => (r.path === path ? { ...r, enabled } : r)))
  if (enabled) {
    for (const p of partitions()) await loadInto(p)
  } else {
    for (const [partition, map] of loaded) {
      const ext = map.get(path)
      if (!ext) continue
      try { session.fromPartition(partition).extensions.removeExtension(ext.id) } catch { /* gone */ }
      map.delete(path)
    }
  }
  return status()
}

export function status(): ExtensionStatus[] {
  return records().map((r) => {
    const anywhere = [...loaded.values()].some((m) => m.has(r.path))
    return {
      ...r,
      loaded: anywhere,
      error: !existsSync(join(r.path, 'manifest.json'))
        ? 'The folder is gone.'
        : r.enabled && !anywhere ? 'Enabled but did not load.' : null
    }
  })
}

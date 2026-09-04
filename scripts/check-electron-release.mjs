import { readFileSync } from 'node:fs'
const current = JSON.parse(readFileSync('package.json', 'utf8')).devDependencies.electron
const response = await fetch('https://releases.electronjs.org/releases.json', { signal: AbortSignal.timeout(20_000) })
if (!response.ok) throw new Error('Could not verify current Electron releases.')
const releases = await response.json()
const latest = releases.find((r) => /^\d+\.\d+\.\d+$/.test(r.version))
if (!latest || latest.version !== current) {
  throw new Error(`Electron ${current} needs review against current stable ${latest?.version ?? 'unknown'}. Follow docs/SECURITY-OPERATIONS.md.`)
}
console.log(`Electron ${current} matches the latest stable release.`)

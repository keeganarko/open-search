// Unsigned application for manual testing, separate from signed releases and
// the dedicated runtime-security executable. Run npm run build first.
import { build } from 'electron-builder'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { verifyArchive } from './verify-asar.mjs'

const files = readdirSync('out/main', { recursive: true }).filter((name) => name.endsWith('.js'))
for (const name of files) {
  const source = readFileSync(join('out/main', name), 'utf8')
  if (name.includes('runtimeSelfTest') || source.includes('Must not autosave') || source.includes('BEGIN PRIVATE KEY')) {
    throw new Error('Rebuild without security-test fixtures before packaging a preview.')
  }
}
await build({ win: ['dir'], x64: true, publish: 'never', config: { directories: { output: 'release/preview' } } })
verifyArchive('release/preview/win-unpacked/resources/app.asar')

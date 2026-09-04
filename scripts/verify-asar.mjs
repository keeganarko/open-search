import { listPackage, statFile, extractFile } from '@electron/asar'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function verifyArchive(archive) {
  let count = 0
  for (const path of listPackage(archive)) {
    const name = path.slice(1)
    const info = statFile(archive, name)
    if (info.files || info.link) continue
    if (!info.integrity || info.integrity.algorithm !== 'SHA256') throw new Error(`Missing file integrity: ${name}`)
    const bytes = info.unpacked ? readFileSync(join(`${archive}.unpacked`, name)) : extractFile(archive, name)
    if (bytes.length !== info.size || createHash('sha256').update(bytes).digest('hex') !== info.integrity.hash) {
      throw new Error(`Packaged file integrity mismatch: ${name}. Rebuild from unchanged inputs.`)
    }
    count++
  }
  console.log(`Verified ${count} packaged file hashes.`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href && process.argv[2]) {
  verifyArchive(process.argv[2])
}

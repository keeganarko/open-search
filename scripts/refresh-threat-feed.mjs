import { writeFileSync } from 'node:fs'
const url = 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/tif.medium-onlydomains.txt'
const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'error' })
if (!response.ok) throw new Error('Threat feed could not be fetched for the release.')
const chunks = []
let bytes = 0
for await (const chunk of response.body) {
  bytes += chunk.length
  if (bytes > 24 * 1024 * 1024) throw new Error('Threat feed exceeded its size bound.')
  chunks.push(chunk)
}
const text = Buffer.concat(chunks).toString('utf8')
const date = Date.parse(/^# Last modified: (.+)$/m.exec(text)?.[1] ?? '')
if (!Number.isFinite(date) || date > Date.now() + 300_000 || Date.now() - date > 7 * 86400_000) {
  throw new Error('Refusing to ship a stale or malformed threat feed.')
}
const entries = text.split('\n').filter((line) => line && !line.startsWith('#'))
if (entries.length < 100_000 || entries.length > 750_000 || entries.some((host) => host.length > 253
  || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(host))) {
  throw new Error('Threat feed is malformed or incomplete.')
}
writeFileSync('resources/security/threat-domains.txt', text)
console.log(`Bundled ${entries.length} threat domains, dated ${new Date(date).toISOString()}.`)

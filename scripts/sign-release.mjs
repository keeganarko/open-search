import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { createReadStream, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const directory = process.argv[2]
if (!directory) throw new Error('Usage: node scripts/sign-release.mjs <release-directory>')
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Only stable version tags may be signed.')
const privateKey = createPrivateKey(process.env.VOYAGER_UPDATE_PRIVATE_KEY ?? '')
if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('An Ed25519 signing key is required.')
const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString()
const keys = JSON.parse(readFileSync('resources/security/update-keys.json', 'utf8'))
if (!keys.includes(publicKey)) throw new Error('Signing key is not trusted by the shipped application.')
const files = []
for (const name of readdirSync(directory).sort()) {
  if (!/\.(?:exe|dmg|zip|AppImage|yml|blockmap)$/.test(name)) continue
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(name)) throw new Error('Unsafe artifact name.')
  const path = join(directory, name)
  if (!statSync(path).isFile()) continue
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  files.push({ name, size: statSync(path).size, sha512: hash.digest('base64') })
}
for (const extension of ['.exe', '.zip', '.AppImage']) {
  if (!files.some((file) => file.name.endsWith(extension))) throw new Error(`Missing ${extension} release.`)
}
const payload = JSON.stringify({ version, publishedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(), files })
const signature = sign(null, Buffer.from(payload), privateKey).toString('base64')
writeFileSync(join(directory, 'voyager-security.json'), JSON.stringify({ payload, signature }) + '\n')
console.log(`Signed ${files.length} artifacts for Voyager ${version}.`)

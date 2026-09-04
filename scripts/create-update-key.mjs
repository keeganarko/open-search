import { generateKeyPairSync } from 'node:crypto'
import { writeFileSync, realpathSync, readFileSync } from 'node:fs'
import { dirname, resolve, relative, sep, isAbsolute } from 'node:path'

const target = process.argv[2]
if (!target) throw new Error('Pass a private-key filename outside the repository. Keep an offline backup.')
const directory = realpathSync(dirname(resolve(target)))
const distance = relative(realpathSync('.'), directory)
if (distance !== '..' && !distance.startsWith(`..${sep}`) && !isAbsolute(distance)) {
  throw new Error('Private keys must be outside the repository.')
}
const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})
writeFileSync(target, privateKey, { flag: 'wx', mode: 0o600 })
const path = 'resources/security/update-keys.json'
const keys = JSON.parse(readFileSync(path, 'utf8'))
keys.push(publicKey)
writeFileSync(path, JSON.stringify(keys, null, 2) + '\n')
console.log('Private key saved outside the repository; public trust key added. No private key was printed.')

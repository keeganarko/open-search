import { readFileSync } from 'node:fs'
import { createPublicKey } from 'node:crypto'
const config = JSON.parse(readFileSync('package.json', 'utf8'))
const keys = JSON.parse(readFileSync('resources/security/update-keys.json', 'utf8'))
if (!keys.length || keys.some((pem) => createPublicKey(pem).asymmetricKeyType !== 'ed25519')) {
  throw new Error('Configure the production update public key before making a release.')
}
if (!process.env.WIN_PUBLISHER_NAME) throw new Error('WIN_PUBLISHER_NAME must exactly match the signing certificate subject.')
if (process.env.GITHUB_REF && process.env.GITHUB_REF !== `refs/tags/v${config.version}`) {
  throw new Error('The protected release tag must match package.json.')
}
console.log('Release trust configuration is present.')

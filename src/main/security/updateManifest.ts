import { createPublicKey, verify } from 'node:crypto'
import { z } from 'zod'

export const RELEASE_ROOT = 'https://github.com/keeganarko/voyager/releases'
export const releaseVersion = z.string().regex(/^\d+\.\d+\.\d+$/)
const artifact = z.object({
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/),
  sha512: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  size: z.number().int().positive().max(4 * 1024 ** 3)
}).strict()
const schema = z.object({
  version: releaseVersion, publishedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  files: z.array(artifact).min(1).max(40)
}).strict()
export type SignedRelease = z.infer<typeof schema>

export function newerVersion(candidate: string, current: string): boolean {
  const a = releaseVersion.parse(candidate).split('.').map(Number)
  const b = releaseVersion.parse(current).split('.').map(Number)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

/** Sign the exact payload bytes; never trust GitHub metadata or its checksums alone. */
export function verifyRelease(raw: string, keys: string[], now = Date.now()): SignedRelease {
  if (raw.length > 64 * 1024) throw new Error('Update manifest is too large.')
  const envelope = z.object({ payload: z.string(), signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) })
    .strict().parse(JSON.parse(raw))
  const signature = Buffer.from(envelope.signature, 'base64')
  if (!keys.some((pem) => {
    const key = createPublicKey(pem)
    return key.asymmetricKeyType === 'ed25519' && verify(null, Buffer.from(envelope.payload), key, signature)
  })) throw new Error('Update signature is not trusted.')
  const release = schema.parse(JSON.parse(envelope.payload))
  const published = Date.parse(release.publishedAt)
  const expires = Date.parse(release.expiresAt)
  if (published > now + 5 * 60_000 || expires <= now || expires <= published
    || expires - published > 31 * 86400_000) throw new Error('Update manifest is expired or has invalid dates.')
  if (new Set(release.files.map((f) => f.name)).size !== release.files.length) {
    throw new Error('Duplicate update artifact.')
  }
  return release
}

export function matchUpdateFiles(release: SignedRelease, info: {
  version: string; files: { url: string; sha512: string; size?: number }[]
}): void {
  if (info.version !== release.version || !info.files.length) throw new Error('Update version mismatch.')
  for (const file of info.files) {
    // Restrict metadata to plain filenames in the authenticated release directory.
    const match = release.files.find((f) => f.name === file.url)
    if (!match || match.sha512 !== file.sha512 || match.size !== file.size) {
      throw new Error('Update metadata does not match the signed release.')
    }
  }
}

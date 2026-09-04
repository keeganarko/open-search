import { Agent } from 'undici'
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

const blocked = new BlockList()
const blocked6 = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4]
] as const) blocked.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [
  ['::', 96], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48],
  ['100::', 64], ['2001::', 32], ['2001:2::', 48], ['2001:10::', 28], ['2001:20::', 28],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]
] as const) blocked6.addSubnet(address, prefix, 'ipv6')

export function publicAddress(address: string): boolean {
  const type = isIP(address)
  return type === 4 ? !blocked.check(address, 'ipv4') : type === 6 && !blocked6.check(address, 'ipv6')
}

export function validateConnectorEndpoint(raw: string): URL {
  const url = new URL(raw)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (url.protocol !== 'https:' || url.username || url.password || url.hash
    || (url.port && url.port !== '443') || host === 'localhost' || host.endsWith('.localhost')
    || host.endsWith('.local') || (!isIP(host) && !host.includes('.'))
    || (isIP(host) && !publicAddress(host))) {
    throw new Error('Connectors require a public HTTPS endpoint on port 443.')
  }
  return url
}

// Resolve at the actual socket connection, not as a separate preflight that DNS
// rebinding can invalidate. Keep normal TLS hostname/certificate validation.
export const connectorDispatcher = new Agent({
  maxResponseSize: 8 * 1024 * 1024, headersTimeout: 15_000, bodyTimeout: 60_000,
  connect: {
    timeout: 15_000,
    lookup(hostname, options, callback) {
      void lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
        if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) {
          throw new Error('Connector DNS resolved to a private or reserved address.')
        }
        const family = typeof options === 'number' ? options : options.family
        const valid = family ? addresses.filter((a) => a.family === family) : addresses
        if (!valid.length) throw new Error('No permitted connector address.')
        if (typeof options === 'object' && options.all) (callback as Function)(null, valid)
        else (callback as Function)(null, valid[0].address, valid[0].family)
      }).catch((error) => (callback as Function)(error))
    }
  }
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { matchesThreat, parseThreatList } from '../src/main/security/threats'
import { downloadRisk } from '../src/main/security/downloads'
import { publicAddress, validateConnectorEndpoint } from '../src/main/security/connectorNetwork'

describe('local threat protection', () => {
  it('loads the complete shipped domain list as data', () => {
    expect(parseThreatList(readFileSync('resources/security/threat-domains.txt', 'utf8')).size).toBeGreaterThan(100_000)
    expect(() => parseThreatList('malware.example')).toThrow(/incomplete/)
    expect(() => parseThreatList('<script>run()</script>')).toThrow(/Malformed/)
  })
  it('blocks subdomains and trailing dots without suffix confusion', () => {
    const list = new Set(['malware.example'])
    for (const url of ['https://malware.example', 'https://a.malware.example./x', 'wss://malware.example']) {
      expect(matchesThreat(url, list)).toBe(true)
    }
    expect(matchesThreat('https://notmalware.example', list)).toBe(false)
    expect(matchesThreat('https://malware.example.safe.example', list)).toBe(false)
  })
})
describe('download restrictions', () => {
  it('blocks executable formats, deceptive names and insecure redirect chains', () => {
    for (const filename of ['invoice.pdf.exe', 'setup.MSI', 'shortcut.lnk', 'invoice\u202epdf.exe', 'foo.pdf.', 'CON.txt', 'a.txt:evil.exe']) {
      expect(downloadRisk(filename, ['https://example.com/file'])).toBeTruthy()
    }
    expect(downloadRisk('a.pdf', ['http://example.com', 'https://example.com'])).toBeTruthy()
    expect(downloadRisk('a.pdf', ['https://example.com'], 'application/x-msdownload')).toBeTruthy()
    expect(downloadRisk('report.pdf', ['https://example.com/report.pdf'])).toBeNull()
  })
})
describe('connector egress restrictions', () => {
  it('blocks local, mapped, link-local, cloud metadata and reserved addresses', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.1', '100.100.100.200', '::1', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1', '64:ff9b::7f00:1']) {
      expect(publicAddress(address), address).toBe(false)
    }
    expect(publicAddress('8.8.8.8')).toBe(true)
    expect(publicAddress('2606:4700:4700::1111')).toBe(true)
  })
  it('requires a public HTTPS endpoint without routing overrides', () => {
    for (const url of ['http://example.com/mcp', 'https://localhost/mcp', 'https://127.1/mcp', 'https://2130706433/mcp', 'https://[::1]/mcp', 'https://user:secret@example.com/mcp', 'https://example.com:444/mcp']) {
      expect(() => validateConnectorEndpoint(url), url).toThrow()
    }
    expect(validateConnectorEndpoint('https://service.example/mcp').hostname).toBe('service.example')
  })
})

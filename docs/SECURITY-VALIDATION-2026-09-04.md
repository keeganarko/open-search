# Security validation — September 4, 2026

Application revision: [`bec7975`](https://github.com/keeganarko/voyager/commit/bec7975baac36a98cc4b4e6657f8426186298bd2).
[GitHub validation run](https://github.com/keeganarko/voyager/actions/runs/33930534039):
all three jobs passed. Later documentation-only commits do not change these results.

**Suitable for public experimental source; production release requirements remain.**
See [security operations](SECURITY-OPERATIONS.md) for activation steps and the
[original audit](SECURITY-AUDIT-2026-09-04.md) for the historical findings and
Chrome/Dia comparison. These checks are automated implementation validation,
not an independent penetration test or a claim that every flaw is eliminated.

| Check | Observed result |
|---|---|
| TypeScript and regression tests | Pass; 128 tests in 19 files |
| Real encrypted SQLite storage | 14 checks pass, including encrypted data/index/WAL, key rejection, migration and recovery protection |
| Release signer integration | Trusted signatures accepted; tampering and an unpinned key rejected |
| Production build | Pass; dedicated runtime fixtures, resolver overrides and temporary TLS private keys absent |
| Dependencies | `npm audit` reports zero known vulnerabilities in the locked dependency tree |
| Source publication | Gitleaks found no secrets in staged source or reachable Git history; GitHub secret scanning and push protection enabled |
| Engine freshness | Electron 44.2.0 matches the stable version checked; packaged Chromium 152.0.7977.76 |
| Packaged integrity | All 5,870 packaged file hashes verified in the Linux fixture; Windows archive verification and all configured fuse checks also pass |
| Packaged Windows | **15/15 pass** on GitHub's Windows runner, including actual OS-protected storage availability |
| Packaged Linux / WSL | **14/15 pass**; OS-vault availability fails because this host has no secure keyring. The overall report correctly fails. |
| Windows Hello helper | Compiles with the Windows SDK and hardened linker options; successful interactive verification still needs a supported device |
| macOS runtime / Touch ID | Not exercised here |

The packaged checks exercise actual sandboxed preloads, absence of Node and UI
APIs in web pages, trusted settings IPC, cross-site renderer separation,
cross-origin frame access, cookie partitioning, normal rejection of untrusted
TLS certificates, threat domains and redirects, permission denial, UI CSP,
HTTP download refusal, executable bytes renamed as a document, safe HTTPS
file publication, and disabled spellcheck dictionary traffic. Windows also
verifies the downloaded file's Internet Zone.Identifier marking.

Each run creates an isolated temporary profile and uses harmless loopback
fixtures. On vault-less Linux test hosts, an ephemeral key permits unrelated
checks to run; the vault check still fails. Production contains no such fallback.
No renderer sandbox or Windows Application Control policy was relaxed. Only
the exact temporary certificate is trusted for TLS download fixtures after the
untrusted-certificate check; that exception is absent from production. The local Windows host blocked the unsigned test app; validation ran on
GitHub's Windows host instead.

Earlier iterations caught asset changes during archiving, omission of hoisted
dependencies through a linked dependency directory, a missing Windows linker
library, and dictionary traffic despite disabled spellchecking. The resulting
fixes are in the tested revision. Packaging copies complete inputs and verifies
archive bytes; dictionary download routing is constrained before sessions start.

Chromium NetLog and fixture-server observations cover controlled test requests.
The final Linux log contains only fixture HTTP(S) URLs; threat-blocked URLs can
appear in NetLog without reaching the server. This is not a real browsing packet
capture and does not validate all proxy, VPN, DNS, WebRTC or extension behavior.
Raw logs and disposable profiles are excluded from Git. CI evidence is retained
for seven days; this document preserves the result after those artifacts expire.

Remaining release requirements:

- Supply and protect real Windows/macOS signing identities and the updater's
  production manifest key. The empty public trust list intentionally disables updates.
- Rehearse installation and updates with signed artifacts, including tampering,
  wrong-publisher/key and expired-manifest rejection.
- Validate successful Windows Hello/Touch ID and native credential-vault behavior
  on supported devices, and complete macOS packaged testing.
- Obtain independent review of exact release artifacts and real traffic behavior.
- Decide whether to add real-time URL/binary reputation and archive/document
  inspection. Current local domain blocking is narrower than Chrome Safe Browsing.

The open Voyager installation does not acquire source changes automatically.
Existing unsigned 0.1.0 artifacts remain testing builds; no new binary release
was published during this work.

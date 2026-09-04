# Security implementation and release operations

Follow-up to the September 4, 2026 source audit. These controls are implemented
in the source. Existing 0.1.0 installations do not gain them until rebuilt
and installed. This document distinguishes implementation from operational
activation and independent assurance.

## 1. Signed updates and engine patches

The updater checks every four hours, with an initial check after startup. It
accepts only a stable version newer than the installed version. A separate
Ed25519 signature authenticates the exact release manifest, version, artifact
names, sizes and SHA-512 hashes. Manifests expire after at most 31 days. Metadata
must match that manifest; downloaded bytes are checked again before installation.
Web installers, differential downloads, prereleases, downgrades and installation
on quit are disabled. The restart prompt can be revisited in Settings → Security.

Windows additionally requires configured publisher identities and Authenticode
verification; macOS uses signed, notarized bundles and native updater signature
verification. Linux AppImages use the Ed25519 manifest and full-file hash checks.
The manifest key provides an authentication boundary separate from the release
repository name and its unsigned update metadata.

The release workflow builds Windows x64, macOS arm64 and Linux x64, validates
source and native storage, runs the packaged Windows checks, verifies every
Windows executable, signs the manifest, and creates a **draft** GitHub release.
Publishing that draft remains the final release action. No release was published
as part of this implementation.

Activation requirements:

1. Create an Ed25519 key using `node scripts/create-update-key.mjs /absolute/path/outside/repo/update-private.pem`.
   Keep an offline protected backup. Commit only the public key written to
   `resources/security/update-keys.json`. The empty shipped trust list deliberately
   disables updates until a production identity is configured.
2. Set `VOYAGER_UPDATE_PRIVATE_KEY` in GitHub's protected `release` environment.
   For Windows set `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD`; the link may
   be electron-builder's base64 certificate input. Set the GitHub environment variable
   `WIN_PUBLISHER_NAME` to the certificate's exact subject common name. Do not
   use a guessed company name.
3. Set `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`,
   `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` for macOS signing and
   notarization. An Apple Developer identity and a Windows signing certificate
   must be obtained by the owner. They cannot be manufactured by this code change.
4. Run the workflow on a version tag matching package.json, inspect the draft,
   install and test signed artifacts, and rehearse a successful update plus
   rejection of tampered, wrong-key, wrong-publisher and expired artifacts.

The repository's `release` environment was created and verified on September 4:
it requires owner review and permits only `v*` tags. There are currently no
signing secrets in that environment. A sole owner can review their own run;
add a second maintainer and disallow self-review when two-person release control
is available. Repository administrators remain a trust boundary.

Daily CI compares the pinned Electron version with the current stable release;
Dependabot checks npm daily. A mismatch fails the engine check. The maintainer
must monitor these failures and upstream advisories. For an urgent engine fix:

1. Triage the upstream Electron/Chromium advisory and determine affected releases.
2. Update the exact Electron pin and lockfile on a patch branch; increment Voyager.
3. Run source, native database and packaged checks, then signed-platform smoke
   tests. Do not bypass signature, certificate or sandbox checks to ship faster.
4. Create the protected tag, review and publish the signed draft, and verify the
   update from a previous supported build. Announce affected versions without
   disclosing unnecessary exploit details before users can patch.
5. Record elapsed patch time. Treat same-day triage and a 24-hour emergency patch
   as operating targets until rehearsed and staffed; no delivery SLA is claimed.

Recovery uses a **newer** signed version reverting the faulty change. Never enable
automatic downgrade. Key rotation requires an overlap release trusting both old
and new public keys before retiring the old signer. Key compromise requires an
incident response and potentially a separately authenticated reinstall. Keep the
release namespace under control. A blocked network or compromised release host
can prevent updates even though it cannot forge signatures. A client more than
30 days behind may need a newly signed release/manifest or a manual verified
installer; manifest expiry is intentionally fail-closed.

## 2. Sites, traffic and downloads

The bundled HaGeZi medium threat feed blocks known malicious/phishing domains
and their subdomains before page, frame, subresource and WebSocket requests.
Voyager owns one request listener and runs threat checks before optional ad
filtering. Disabling ads cannot uninstall threat protection. Ghostery cosmetic
script injection is no longer enabled. Chromium site-per-process isolation is
explicitly enabled.

Threat-list refreshes contact one fixed public GitHub URL every four hours.
Browsed URLs, cookies and local records are not sent to the feed. Only bounded,
validated domain data is accepted. A bundled list works offline; a failed refresh
keeps the last valid list and Settings → Security shows the error and freshness.
The list's own generation time determines staleness, rather than installation
time. Its separate data license and source are preserved under resources/security.

Downloads require an entirely HTTPS redirect chain and a source outside the
known threat list. Executables, installers, scripts, shortcuts and deceptive
filenames are blocked. Other downloads stage in a private quarantine directory
and are checked for common executable byte signatures even if renamed as a
document. Windows Internet Zone.Identifier / macOS quarantine markings are
applied before an atomic, non-overwriting publication into Downloads. Failure to
check, mark or publish a file blocks it. Linux files are saved without execute
permission. Failed and interrupted staged files are removed.

This is **not Chrome Safe Browsing parity**. Domain lists miss threats on otherwise
legitimate domains and newly created attacks. There is no real-time URL
reputation, binary antivirus engine, archive inspection, document macro analysis
or CDR service. An encrypted archive remains opaque. These would need an explicit
provider, privacy policy and service integration before broad primary-browser
use. HTTP browsing remains possible with an insecure connection indicator;
ordinary TLS certificate validation remains Chromium's responsibility.

Spellchecking defaults off. On Windows and Linux, enabling it can download
language dictionaries from Google's CDN; the operating-system checker is used
on macOS. The Privacy setting describes this traffic. Electron documents that
local spellchecking does not send typed text to Google. Controlled NetLog tests
check that disabled spellchecking does not request dictionaries. Enabling it
requires a restart for existing tabs and the sidebar. These tests
are useful for discovering connections but are not a complete packet
capture or a proxy/VPN leakage assessment.

## 3. Packaged validation and independent review

`npm run security:package` builds a dedicated packaged Windows test application
(`npm run security:package -- --linux` selects Linux)
with the same renderer/preload modules and security fuses. The test branch and
temporary TLS fixture are compiled out of normal builds. It cannot use a normal
browser profile: it creates a new temporary directory for all records, sessions
and downloads and maps its fixture hostnames to loopback. Packaging freezes app
inputs before archiving and verifies every packaged file hash. On Linux test
hosts without a vault, an ephemeral in-memory database key lets unrelated tests
run; the OS-vault check still fails. That fallback is absent from production.

`scripts/run-security-runtime.ps1` runs that binary, enforces a timeout, and fails
if its JSON report is missing or any check fails. The suite covers real sandboxed
preloads, Node isolation, UI IPC, cross-site process separation, same-origin
enforcement, cookie partitioning, rejection of untrusted certificates, threat
redirects, denied permissions, HTTP download blocking, renamed executable bytes,
and Windows Internet-origin marking. It records Chromium NetLog and the fixture
server's observed requests. Evidence lives under ignored `security-results/`
and is uploaded by CI with seven-day retention. No real browsing data is used.

This is an automated integration suite written with the implementation, **not an
independent security assessment**. A separate reviewer should test the exact
signed installers, real network/proxy/VPN behavior, WebRTC/DNS leakage, permission
races, cross-origin/OOPIF transitions, update tampering and credential-vault
behavior on Windows, macOS and Linux. Successful Windows Hello/Touch ID prompts
require actual supported devices or interactive test hosts. Building the Windows
helper locally requires Visual Studio C++ tools and the Windows SDK.

## 4. Connectors, encryption and password reveal

Local stdio connectors cannot execute. There is no advertised filesystem sandbox
that merely relies on a connector obeying its own directory argument. Restoring
local programs would require a real OS containment design, per-connector working
directories, explicit filesystem/network grants and pinned program identities.

Hosted MCP connectors require public HTTPS port 443, fixed endpoint paths, no
credential-bearing URL, no redirect following and no overridden routing headers.
DNS is checked when the actual socket connects; private, loopback, link-local,
metadata, mapped and reserved addresses are refused. Responses and request
arguments are bounded. Each connector belongs to one profile; other profiles
cannot advertise or execute its tools. Old unscoped connectors must be added
again in their intended profile. Imports receive new IDs and remain disabled.
Each tool call retains the existing approval requirement. OAuth/discovery that
requires additional endpoints is currently unavailable. Provider account scopes
still determine what a hosted service can do with its token.

The entire Voyager SQLite database, including its FTS search indexes and WAL,
uses SQLite3 Multiple Ciphers ChaCha20 authenticated encryption through the pinned
`better-sqlite3-multiple-ciphers` package (installed under the existing module
name). A random 256-bit key is wrapped by Electron safeStorage. Linux basic_text
is rejected. A locked or unavailable OS vault prevents database access; there
is no plaintext storage fallback. SQL temporary data stays in memory.

Plaintext databases migrate before use. Existing WAL data is checkpointed,
integrity is checked, and a separately AES-GCM encrypted recovery snapshot is
durably written before rekeying. The converted file is closed and reopened with
the protected key before the snapshot is deleted. A failed or interrupted
migration preserves encrypted recovery data and stops startup, preventing a
second migration from replacing the only recovery copy. Do not delete or replace
the protected database key in response to an error. Recovery requires the same
OS account/key and a controlled restore from that snapshot. Prior plaintext
backups, SSD remnants, crash dumps and filesystem snapshots cannot be retroactively
erased by encrypting the current file.

Back up `voyager.db` and `database-key.enc` together with the protected OS account
state, or use the existing passphrase-encrypted sync export for its supported
records. Sync is not a full-fidelity profile/password backup. Chromium caches,
website storage, exports and downloaded files are outside the encrypted database.
Use device disk encryption. Same-account malware can access an unlocked app and
OS vault; database encryption does not promise protection from that attacker.

Password reveal now requires Touch ID on supported Macs or a native HWND-bound
Windows Hello verification. Cancellation, timeout, profile/window changes,
unsupported platforms, missing helpers and unavailable authentication all deny
reveal. There is no confirmation-only fallback and no cached authorization.
Revealed UI values are cleared after 30 seconds or a panel change. Linux and
Macs without Touch ID currently support origin-bound filling but not reveal.

## Remaining decisions and release gates

- Supply real signing identities and protect their custody; the source tree
  intentionally contains no production private keys.
- Complete the signed update rehearsal and successful platform authentication
  tests. Commission independent testing of exact signed artifacts.
- Choose a reputation/antivirus provider if executable downloads and Chrome-level
  threat coverage are required. The current conservative blocking policy changes
  download functionality.
- Decide whether local connectors return at all, and fund an actual OS sandbox.
- Extend retained-data deletion and encryption to any new data stores, and decide
  whether Linux reveal/password fallback needs a native authentication component.
- Independently evaluate extensions: unpacked code is still a large separate
  trust surface. This implementation does not establish a signed extension store.

References: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[electron-builder update security](https://www.electron.build/docs/features/security/),
[SQLite3 Multiple Ciphers pragmas](https://utelle.github.io/SQLite3MultipleCiphers/docs/configuration/config_sql_pragmas/),
[Windows Hello desktop verification](https://learn.microsoft.com/en-us/windows/win32/api/userconsentverifierinterop/nn-userconsentverifierinterop-iuserconsentverifierinterop),
[HaGeZi feed source](https://github.com/hagezi/dns-blocklists),
[Dia security](https://www.diabrowser.com/security),
[Electron spellchecker traffic](https://www.electronjs.org/docs/latest/tutorial/spellchecker/).

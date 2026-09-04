# Voyager security and publication audit

**Implementation follow-up:** [SECURITY-OPERATIONS.md](SECURITY-OPERATIONS.md) documents
the subsequent update, reputation, packaged-test, encryption and authentication
work. Findings and counts below describe the earlier audit baseline.

Date: 2026-09-04. Baseline: `d751d3041aa7176c684fb690c998bb6ce4df35c2`, plus
the existing working-tree edits and the local fixes from this audit.

## Readiness decision

**Public experimental source: reasonable. Primary browser or sensitive-account
production release: not ready.** Public source does not grant an attacker access
to an installed browser. Security must survive an attacker knowing the code.
However, the existing public source and installer have issues addressed only by
the uncommitted changes described below. Those changes still need review,
packaged runtime validation, and distribution.

This is a source/configuration audit with targeted security regression tests,
dependency and secret scans, and read-only inspection of an existing Windows
binary. It is not an independent penetration test, an exploit-free guarantee,
or an empirical Chrome/Dia penetration-test comparison. No finite audit can
establish that every vulnerability has been eliminated.

The earlier [browser audit](AUDIT.md) is a historical verification record. Its
claims about complete permission isolation, drafting never sending data,
background tools being read-only, and prompt-injection protection were broader
than the implementation justified. Use this report for security readiness.

## Scope and evidence

Reviewed surfaces include startup and protocols; windows, tabs, navigation and
popups; page/chrome preloads and IPC; sessions, permissions, screen sharing,
downloads, passwords and extensions; agent tools and both execution loops;
MCP transport; history, memory, settings and sync; renderer HTML/CSP, Markdown,
links and favicons; dependencies and packaging; Git history and GitHub settings.
SQL accesses use prepared parameters for user values; dynamic table identifiers
observed in migrations/deletion are application-owned constants.

| Check | Result and scope |
|---|---|
| TypeScript | Main, preload, shared contract, and renderer pass |
| Security/unit tests | 111 tests across 15 files; Electron and SQLite are stubbed, with VM execution for page-bridge and credential-delivery regressions |
| Production build | Main, preloads, and both renderer bundles pass |
| Dependency scan | `npm audit`: zero known vulnerabilities in the resolved tree at audit time; this is not a Chromium exploit assessment |
| Secret scan, history | Gitleaks 8.30.1, checksum verified, all seven commits reachable from local refs; no leaks detected; GitHub main matched the local baseline |
| Secret scan, working source | No leaks detected; included tracked/new source and expanded XML/relationships from the PowerPoint template |
| GitHub | Public repository confirmed; security settings described below queried after changes |
| Existing Windows binary | Authenticode status `NotSigned`; fuse bytes read from the executable and matched intended hardening |
| New installer/runtime | Not built or launched in this audit; existing `release/` artifacts were not replaced |
| CI | Workflow prepared locally; not pushed or executed on GitHub |

The existing executable has RunAsNode, NODE_OPTIONS, Node CLI inspection and
extra file-protocol privileges disabled, and cookie encryption, embedded ASAR
integrity and ASAR-only loading enabled. These are useful boundaries but do not
authenticate an unsigned executable's publisher.

No live attack traffic was sent to third-party websites or connected accounts.
There was no packet capture, MITM lab, live model-injection campaign, native
credential-vault test, native screen-sharing test, or cross-platform renderer
exploit test. The engine's compiled native dependencies were not audited line
by line. Findings below distinguish fixes from remaining validation needs.

## Findings addressed in the local source

Severity reflects plausible impact given the stated prerequisite, not a CVSS
assessment. All fixes below remain local until reviewed and released.

| ID | Severity | Finding and attack prerequisite | Change |
|---|---|---|---|
| V-01 | High | A model could return an unadvertised connector tool in `oneShot`; the fallback dispatched any name to MCP despite the advertised read-only subset. A hostile document influencing the model could therefore reach unintended tools. | Background execution uses an exact local tool allowlist and has no MCP fallback. No connector tools are advertised to background work. |
| V-02 | High | Opening a model-chosen URL was classified as locally reversible. A URL can carry private text in its path/query or trigger authenticated server behavior. Hosted web tools executed before the application could approve arguments. | Model-driven navigation always asks; excluded destinations are refused. Hosted search/fetch tools are disabled pending an approval-capable outbound broker. |
| V-03 | High | MCP's self-supplied name/description determined whether calls could run silently. Same display-name prefixes also collided across connectors. | Every agent MCP call requires approval. Tool identities include a hash of the stable server ID; pending approval is invalidated by connector replacement/reconnection. Metadata remains descriptive, not an authorization boundary. |
| V-04 | High | `ai.contextConsent` was displayed but not enforced. Background briefs could start with a key and default settings without context consent. | Interactive AI operations obtain native per-task consent unless standing consent is enabled. Scheduled briefs require standing consent and stop while paused. |
| V-05 | High | Page reads checked the optimistic tab URL, then asynchronously extracted another document. Selection ignored Pause. Previously recorded excluded history and excluded tab titles could enter context. | Use live document URLs, check inside the isolated world, discard results on navigation and recheck privacy after awaits. Pause and exclusions apply to selection, history context and tab context. Excluded page blocks omit URL/title. |
| V-06 | High | A saved-password IPC message could arrive after navigation and fill another origin. | The receiving preload requires the approved exact origin and top frame before touching the DOM. Both values are set before page input handlers are notified. |
| V-07 | High | Screen capture checked one frame's URL but asked permission against the top page; async selection/enumeration could outlive the request. A microphone grant was stored as a generic media grant usable for camera. | Use the requesting origin and user gesture, revalidate request/profile/navigation through the picker, deny failures, and separate microphone/camera permission keys. Old generic media grants do not silently authorize either device. |
| V-08 | Medium | Pending permission decisions survived navigation; synchronous/device checks did not consistently reject excluded or unknown capabilities. | Cancel on navigation/destruction, bound prompt lifetime, clean listeners, scope decisions to the originating profile/window, and apply exclusion/known-capability checks. |
| V-09 | High | An authenticated sync bundle could relax exclusions, approval rules, consent and background settings. Only array counts were validated before incremental writes. Connector secrets traveled in the bundle. A disabled imported connector could be started with Reconnect. | Preserve machine-local security policy; import only appearance/search settings. Validate records before writes, enforce the size bound after reading, strip connector env/headers on both import/export, import disabled, and refuse disabled reconnect. |
| V-10 | Medium | Linux `safeStorage.isEncryptionAvailable()` alone can accept `basic_text`, which uses a fixed key. The normal settings response also exposed the stored API key to the UI. | Reject `basic_text` for stored credentials. Settings expose key presence only; stored API keys stay in main. Existing weak-backend credentials may require re-entry after configuring a real vault. |
| V-11 | Medium | A known trusted WebContents ID remained privileged if its document changed; UI navigation lacked redirect/frame defenses. | Require the exact expected UI document as well as sender/main-frame ownership. Block UI navigation, redirects, frames and webview attachment; strengthen CSP. |
| V-12 | Medium | Page-controlled remote favicons loaded again in the shared privileged UI session, outside profile request filtering. | Only bounded raster data-URL icons are accepted; CSP blocks remote UI images. Other sites use placeholder icons until profile-scoped icon caching is built. |
| V-13 | Medium | Chat history/send/delete accepted another profile's conversation ID. Approval/Stop responses were not scoped to their sending window; a queued approved tool could run after Stop. | Check conversation ownership, bind approval/Stop to the window/profile, and recheck task/target state before execution. Background loops stop on profile/window changes. |
| V-14 | High | “Insert draft” was described as unable to send. Websites can transmit every input/change event or autosave immediately. The active destination could change during approval. | Treat insertion as an outbound write, always require approval, bind the approved tab/URL through navigation, and remove the false no-transmission promise. Full tool arguments are visible in a scrollable approval view. |
| V-15 | Medium | Remote MCP transport could follow redirects while carrying configured credentials. | Require the configured origin for requests and refuse HTTP redirects. Servers relying on redirects must use their final endpoint. |
| V-16 | Medium | The address bar displayed a lock from a requested HTTPS URL before navigation had succeeded, including failed certificate loads. | Show the lock only after an HTTPS document successfully commits under normal certificate validation. |
| V-17 | High | The rewrite overlay could apply previously selected private text after its tab navigated to another site. | Bind the reviewed result to the original document, profile, tab and exact text; invalidate on navigation/destruction/expiry and consume it once. |

The regression tests exercise the original failure modes using synthetic data:
unadvertised background dispatch, misleading read-class connector approval,
connector replacement, Stop races, live-URL and Pause checks, navigation
round trips, receiving-origin credential checks, separate media grants,
cross-window permission responses, weakened sync policy, malformed sync records,
disabled reconnect, redirect refusal, namespace collisions and weak key stores.
Native Electron behavior remains a release gate even when these tests pass.

## Traffic and data exposure

| Path | Destination and data | Present protection / remaining concern |
|---|---|---|
| Ordinary browsing | Websites and their third parties receive normal browser requests, cookies and submitted data. Search-box text goes to the selected search engine. | Chromium TLS/certificate validation and web security remain enabled. Explicit HTTP URLs remain allowed. No HTTPS-only mode or reputation service. |
| AI chat and documents | Anthropic receives prompts and approved context, which may contain page text, titles, history, memory and past conversation. | Per-task/standing consent, Pause/exclusions, main-only stored API key. This is cloud inference, not fully local AI. Provider retention and organizational approval still need a product policy. |
| AI outbound operations | Approved URLs and connector arguments can carry private content to websites/services. | Per-call approval for navigation, insertion and all connectors; hosted web tools disabled. A user can still approve a deceptive request. |
| MCP over HTTP | Configured endpoint receives tool arguments and configured authentication. | HTTPS required except loopback; same-origin requests and redirect rejection. No OS sandbox or destination policy over the remote server's own behavior. |
| MCP over stdio | Local program receives arguments and explicit environment, and runs as the OS user. | Minimal inherited environment and trust prompt. It can still read files, browser data or the network using that user's authority. Secrets embedded in command arguments or URL query strings are not automatically encrypted/redacted. |
| Ad/tracker lists | Ghostery filter downloads use Node fetch; the installed package points to Ghostery assets on `raw.githubusercontent.com`. | Startup can proceed before filters load, and fetch failure leaves browsing available. A zero blocked count is not proof that filtering is active. |
| Page icons | The page may request its own icon as ordinary page traffic. | Privileged UI no longer fetches arbitrary page-provided icon URLs. |
| Sync | User-selected folder, possibly synchronized by their cloud-drive provider. | AES-256-GCM and scrypt; API/connector secrets omitted. Passphrase strength matters. Exported user content remains sensitive even when encrypted. |
| Local data | SQLite contains history excerpts, chats, tool inputs/outputs, memory, bookmarks and skills. Chromium maintains profile cookies/storage/cache. | Secrets have OS encryption; ordinary SQLite content is plaintext. Pause/exclusions do not erase copies already saved in chats, exports, old records or third-party services. |

No app-owned analytics SDK, crash-upload service, listening HTTP server or
remote-control socket was found in project source. This does not establish that
the Chromium engine, operating system, extensions or connector programs make no
background requests. A controlled packet-capture test is still required.

DNT/GPC headers are signals to recipients, not traffic encryption or access
control. HTTPS authenticates/encrypts a connection; it does not determine that
the destination is trustworthy or that sending particular data is authorized.

## Comparison with Chrome and Dia

This compares documented architecture and observed Voyager code. It is not a
numerical security score, an audit of competitor internals, or proof that their
products are vulnerability-free.

| Area | Documented benchmark | Voyager assessment / adoption |
|---|---|---|
| Renderer containment | Chrome documents sandboxing plus Site Isolation, including cross-site frame/process separation and defenses against compromised renderers. | Sandboxing/context isolation are configured. Do not infer Chrome-equivalent Site Isolation from separate WebContentsViews; verify cross-site OOPIF/process behavior in the packaged build. Adopt Chrome's compromised-renderer threat model. [Chromium documentation](https://www.chromium.org/Home/chromium-security/site-isolation/) |
| Malicious destinations | Chrome's Safe Browsing uses reputation protections, including real-time URL checks with privacy safeguards. | Ad blocking is insufficient. Select a suitable URL/download reputation provider and build interstitials and error/override policy. [Google's description](https://security.googleblog.com/2024/03/blog-post.html) |
| AI authority | Dia publicly describes layered prompt-injection defenses and states it does not automatically follow model-generated URLs. | Adopt the assumption that injection will happen. Voyager now gates navigation and connector actions and disables ungated hosted tools; it still needs narrow per-task source/destination authority. [Dia security](https://www.diabrowser.com/security) |
| Data handling and assurance | Dia describes local encryption, cloud processing for AI features, data controls and a researcher reporting program. | Voyager's ordinary SQLite data is not encrypted, and no equivalent independently reviewed assurance has been established. Document collection/retention accurately and build controls to match. [Dia security](https://www.diabrowser.com/security) |

Electron explicitly warns that it is not a browser security product for arbitrary
untrusted content; an application inherits responsibility for the larger
privileged attack surface. Its checklist is a minimum, not browser certification.
[Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)

The official release listing identifies Electron 44.2.0 with Chromium
152.0.7977.76 and Node 24.20.0 at the time checked. The lockfile pins Electron
44.2.0. Engine freshness must be monitored continuously; an npm audit result
does not replace release-note/CVE review.
[Electron 44.2.0](https://releases.electronjs.org/release/v44.2.0)

OS encryption has platform limits: Electron documents Windows DPAPI protection
against other users, not arbitrary software running as the same user, and the
Linux fixed-key fallback addressed above. Signing is also relevant to consistent
macOS vault access. [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)

## Remaining release blockers

| Priority | Work still required | Completion evidence |
|---|---|---|
| P0 | Signed Windows/macOS distribution, authenticated automatic updates, signing-key custody and emergency engine-patch ownership | Tampered/unsigned/wrong-publisher update rejection, protected publishing job, staged rollout, recovery plan that does not silently downgrade security, and a tested emergency release |
| P0 | Phishing/malware URL checks, malicious-download handling and native quarantine/MOTW validation | Harmless local reputation fixtures, dangerous-file warnings, redirects checked, and Windows/macOS quarantine behavior demonstrated |
| P0 | Independent packaged-runtime security review and regression harness | Hostile IPC/subframe fixtures, same-origin/Site Isolation probes, certificate and mixed-content lab, popup/fullscreen spoofing tests, native credential/screen-share tests, and traffic capture across supported OSs |
| P0 | Review, package and deploy these local fixes | Reviewed diff and a versioned artifact built from that exact revision; existing unsigned 0.1.0 artifacts do not gain these fixes automatically |
| P1 | Profile- and task-scoped AI/connector/extension authority | Explicit allowed sources and destinations, connector identities/policies bound to a profile, document/field capability tokens, and consent revocation/cancellation tests |
| P1 | Secret vault and retained-data design | OS reauthentication for reveal; history/chat/memory encryption and retention/deletion behavior; documented backup/key rotation and protection limits |
| P1 | Secure traffic controls | HTTPS upgrade/exception UX, certificate detail UI, DNS/proxy policy, third-party-cookie policy, and tests for local/private-network requests and WebRTC exposure |
| P1 | Extension and connector supply chain | Trusted distribution or pinned package/content identity, per-profile enabling and permissions, filesystem/network restrictions for connectors, and safe upgrade/reapproval rules |
| P1 | Clear privacy and data-lifecycle semantics | Separate assistant exclusions from site permission policy; private nonpersistent windows; explicit AI provider terms; no implication that Pause deletes data or encrypts traffic |
| P2 | Operational hardening | Auditable approved AI actions, model spend/time budgets, clear blocker failure state, rate limits for page permission/login prompts and popup/download storms, automated engine-age checks and SBOM/provenance |

Further source-level concerns remain: shared/global extensions and MCP settings
are not independent profile trust boundaries; some non-chat record mutations
accept global IDs inside the trusted UI; several IPC payloads still rely on
TypeScript rather than a runtime schema; editable-field targeting within the
same document still needs a field-level capability; stored page text can include
sensitive DOM content because extraction is not a DLP system; and sync writes
are validated first but not one all-or-nothing transaction. A malicious local
program can also modify unpacked extension contents after approval.

Permission prompts share a single overlay surface with other flows, and device
selection/fullscreen exit cues need native UX validation. `clearOnQuit` is
best-effort and cannot provide an incognito guarantee after a crash. Catching
uncaught exceptions and continuing can leave unknown application state; define
a safe recovery policy. These are open work items, not silently accepted proofs
of safety.

## Architecture decisions needed

1. **Product security target:** retain Electron for an experimental personal
   browser, or fund a maintained Chromium-based browser architecture and its
   update/security operations for a primary-browser product? Electron can be
   hardened, but Chromium under it does not automatically supply Chrome's
   complete browser security product.
2. **AI authority:** permit broad autonomous actions, or default to reading
   explicitly selected context with separately approved outbound actions?
   Recommendation: the latter until a deterministic source/destination broker
   and adversarial tests exist. Restoring unattended web/connector tools depends
   on that broker, not stronger prompt prose.
3. **Data promise:** which context can leave the device, which accounts must
   never enter AI context, and what must be encrypted/deleted locally?
   Recommendation: explicit per-profile settings and a visible context preview,
   with private windows fully excluded from background AI/storage.
4. **Release ownership:** who owns signing identities, recovery keys, update
   hosting and emergency patch delivery? Which reputation provider meets the
   product's budget and privacy constraints?
5. **GitHub governance:** which branches/tags require review, who can bypass in
   an emergency, and who can approve a production signing/publishing job?
   Select rules that preserve a workable owner workflow and then enforce them.

## GitHub publication status and changes

The repository was **already public** when checked, with seven commits and no
GitHub releases. No repository visibility change, source push, commit, branch
protection rule or binary publication was performed during this audit.

GitHub initially reported secret scanning, push protection, Dependabot security
updates and private vulnerability reporting disabled. These are now enabled
and were queried again to verify. The secret-alert endpoint returned an empty
list after activation; new scans and future detections may still change that.
`main` has no classic branch protection and the repository ruleset list is empty.

Local additions include `.github/workflows/security.yml`, daily npm/weekly
Actions Dependabot checks, `SECURITY.md`, and ignore rules for profile databases,
sync exports, signing keys and local agent configuration. The workflow uses
pinned action commits, read-only permissions, no persisted checkout credential,
no dependency install scripts, and no secrets. It checks types/tests/build/npm
advisories and scans full Git history with a checksum-pinned Gitleaks binary.
The workflow and Dependabot config become effective only after they are pushed.

Before a production release, require reviewed changes and successful checks,
protect release tags/environments, require strong account authentication, and
keep signing credentials inaccessible to fork PRs. Publishing source should
never publish personal profiles, passwords, API keys, tokens or signing keys.
If a key was ever exposed, revoke it before attempting history cleanup.
GitHub's scanning and push protection are useful layers, not guarantees against
every secret format or malicious contribution.
[Secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning),
[push protection](https://docs.github.com/en/code-security/concepts/secret-security/push-protection)

## Behavior changes to expect

- Interactive AI work can ask for context-sharing consent; scheduled briefs
  require standing consent and do not access connectors. Mail/calendar briefing
  is unavailable until safe background connector capabilities are designed.
- Hosted AI web search/fetch is disabled. Normal browser navigation/search and
  manually approved agent navigation remain available.
- Every connector call, model-driven navigation, page insertion and
  model-written memory requests approval, including previously auto-approved
  classes. Connector calls that redirect or leave their approved origin fail.
- Camera/microphone grants may prompt again; Linux without an actual vault
  cannot save/use protected credentials. Password reveal still uses confirmation,
  not OS reauthentication.
- Remote favicon URLs use placeholders. A profile-scoped cache is future work.
- Sync no longer transfers connector credentials or machine-local security
  choices. Users must re-enter secrets and explicitly enable restored connectors.

The tested source is stronger than the baseline. The public code and any
installed copy remain at their existing versions until the changes are shipped.

# Voyager browser audit

Audit date: 2026-09-04
Scope: application source, Electron boundaries, browser sessions, assistant and
connector execution, local data, Windows packaging, and the primary desktop UI.

## Executive result

Voyager now builds and launches as a standalone x64 Windows application. The
packaged process successfully created its new-tab page, application chrome, and
overlay from the `voyager://` and `voyager-app://` schemes. TypeScript checks,
78 automated tests, the production build, and the native Windows installer all
pass. `npm audit` reports zero known vulnerabilities.

The reviewed build is appropriate for local development and informed testing.
It is not yet recommended as a primary browser for high-risk or general-public
use. The largest remaining differences from a mature browser are signed
automatic updates, phishing and malicious-download reputation protection, a
sustained emergency patch process, and independent security review.

## Verification record

| Check | Result |
|---|---|
| TypeScript, main/preload/renderer | Pass |
| Vitest | 8 files, 78 tests passed |
| Production bundle | Pass |
| Dependency audit | 0 known vulnerabilities |
| Windows package | `Voyager Setup 0.1.0.exe`, x64 NSIS |
| Native launch | Pass; process remained healthy |
| Renderer targets | New Tab, Voyager UI, Voyager overlay |
| Startup error log | None |
| Electron fuses | Run-as-Node off; Node flags/inspect off; cookie encryption, ASAR integrity, ASAR-only loading on |
| Source branding scan | No superseded product or competitor branding in project-owned source/assets |

## Changes made during the audit

### Windows and browser behavior

- Added a stable Windows AppUserModelID, native caption controls, Ctrl-based
  shortcut labels, and platform-correct filesystem examples.
- Added native Edit-menu commands and right-click editing menus for Voyager text
  fields, including copy, paste, paste-and-match-style, undo, redo, and select
  all. Web-page context menus retain native paste.
- Fixed popup opener behavior, recently closed navigation history, profile- and
  origin-specific zoom, unique download paths, internal error pages, and live
  renderer-crash/load-failure reporting.
- Fixed profile switching and deletion across multiple windows and ensured all
  profile-bound data and browsing storage are removed.
- Kept the launch timing and left-to-right wordmark animation while replacing
  the old identity, sound assets, protocols, database names, sync identifiers,
  and application IDs with Voyager-owned versions.
- Replaced the previous icon with the Voyager V/compass mark and produced a
  seven-size Windows icon inside the package.
- Rebuilt deck generation without the vulnerable presentation dependency and
  fixed Markdown report exports to return a real saved-file result.

### Electron boundary hardening

- Upgraded to Electron 44.2.0 and electron-builder 26.15.3.
- Enabled Chromium sandboxing globally and for app/page renderers. Node
  integration is disabled, context isolation and web security are enabled, and
  packaged app developer tools are disabled.
- Replaced packaged `file://` UI loading with a restricted privileged protocol
  that serves only known HTML and hashed bundle assets.
- Applied Electron fuses that disable run-as-Node, Node option injection, and
  CLI inspection while enabling encrypted cookies, embedded ASAR integrity, and
  ASAR-only application loading.
- Restricted app UI navigation and window creation. Page main-frame navigation,
  redirects, typed input, and popups accept web URLs and known Voyager pages;
  active/local schemes such as `javascript:`, `data:`, `blob:`, and `file:` are
  refused.
- Removed the Electron/product tokens from the browser user-agent without
  claiming a different Chromium version.

### IPC, permissions, and credentials

- Main-process IPC now resolves an exact trusted app frame or known tab main
  frame for every channel. Unknown senders do not inherit the focused window.
- Page selection and saved-login payloads are checked against the actual sender
  tab and origin and are size bounded.
- Permission prompts and screen pickers are scoped per window, fail closed, and
  use the requesting frame's security origin. Cross-origin frames cannot inherit
  a top-page decision.
- Camera, microphone, location, notifications, display capture, fullscreen,
  pointer lock, and keyboard lock require a decision. Only sanitized clipboard
  writing is automatically accepted.
- Anthropic keys, saved passwords, and connector secrets use operating-system
  credential encryption. Legacy plaintext connector values are migrated, and
  storage fails closed when encryption is unavailable.
- Password filling requires an exact origin and HTTPS, with loopback HTTP allowed
  for local development. Revealing a saved password requires native confirmation.
- Destructive profile, history, memory, permission, connector, and credential
  actions use explicit default-cancel confirmations.

### Assistant, extensions, sync, and connectors

- Page text, attributes, selections, memory, history, persona text, and skill
  context are escaped and placed in distinct model-context frames. Page data is
  explicitly treated as untrusted, not as instructions.
- Excluded sites cannot be read, remembered, or modified by assistant tools.
  Sensitive-site defaults cover financial, mail, health, government, and
  password-management categories.
- Assistant actions have visible steps and approval classes. Credential,
  deletion, and financial actions always ask and cannot be configured away.
- Connector processes inherit only an allowlist of ordinary environment
  variables plus explicitly configured encrypted values. Configurations are
  bounded and validated; remote connectors require HTTPS except on loopback.
- Enabling a local connector warns that it runs with the user's operating-system
  authority. Imported connectors are disabled so a sync file cannot launch code.
- Sync imports are authenticated/encrypted, versioned, structure validated,
  count bounded, and limited to 25 MB. API keys are never included.
- Unpacked extension manifests are size bounded and their requested permissions
  are shown before a default-cancel trust prompt. File access is disabled.

## Product and interaction design audit

The desktop layout has a clear hierarchy: browsing and tabs on the left, page
content in the center, and assistant work on the right. A packaged 1936×1048
Windows capture confirmed that native caption controls, borders, resize regions,
the centered new-tab search, tab rail, and assistant composer align without
overlap. The empty states explain the three most important shortcuts and the
primary controls remain reachable with long tab lists.

Changes made for interaction quality:

- Preserved the original launch motion and added reduced-motion behavior.
- Increased low-emphasis text colors to accessible contrast levels in light and
  dark themes.
- Added consistent visible keyboard focus treatment to controls.
- Made tab rows and the rail address field keyboard operable and exposed tab
  selection state to assistive technology.
- Added accessible labels to removable skill/context chips.
- Reworded platform-specific actions such as “Show in folder.”
- Added native, discoverable clipboard menus to the app UI.

Remaining design validation should include keyboard-only task completion on
every settings panel, screen-reader passes with Narrator and VoiceOver, 200%
Windows scaling, narrow-window stress tests, and user testing of the vertical tab
model. Those tests require human assistive-technology and workflow judgment and
are not represented by the automated suite.

## Security baseline comparison

| Area | Voyager now | Mature browser baseline |
|---|---|---|
| Engine isolation | Current Electron/Chromium, sandboxed renderers, strict IPC and fuses | Multi-process isolation backed by a large browser-security organization |
| Updates | Manual unsigned installer | Signed automatic updates with staged rollout and emergency response |
| Malicious-site defense | Ad/tracker blocking; no reputation service | Phishing, malware-URL, and risky-download reputation warnings |
| AI/privacy | Local browser data, explicit context, OS-encrypted secrets, action approval | Varies by product and enabled cloud services |
| Assurance | Internal audit and tests | Independent testing, disclosure program, and sustained incident response |

This table is architectural, not a security score. Voyager's strong local-data
and approval model does not compensate for missing phishing intelligence or an
unproven patch pipeline. A mature browser currently provides stronger exploit
response, update distribution, malicious-site reputation, and independent
assurance.

## Remaining risk register and roadmap

### P0 — required before public primary-browser positioning

1. Sign Windows and macOS packages and implement verified automatic updates with
   staged rollout, rollback, and an emergency Chromium/Electron patch SLA.
2. Add phishing, malware-URL, and malicious-download reputation checks with a
   clear privacy policy and an override interstitial.
3. Commission an independent penetration test covering custom protocols, IPC,
   navigation, permissions, credential flows, updates, and model-tool boundaries;
   then publish a security contact and coordinated-disclosure/bounty process.
4. Add release CI that runs tests/audit, verifies fuses and ASAR integrity,
   generates an SBOM, scans secrets, and produces reproducible provenance.

### P1 — important security and privacy controls

1. Add private windows with non-persistent partitions and guaranteed cleanup.
2. Add HTTPS-only navigation upgrades, certificate-error UI/policy, and
   configurable secure DNS.
3. Replace arbitrary unpacked-extension loading with a signed or allowlisted
   distribution model and per-extension permission management.
4. Encrypt sensitive local history/memory fields at rest, add retention controls,
   and support OS reauthentication—not confirmation alone—for password reveal.
5. Add download quarantine/mark-of-the-web handling and risky-file UX.

### P2 — defense depth and assurance

1. Build hostile-page regression fixtures for IPC spoofing, cross-origin
   permissions, popup/opener behavior, prompt injection, and renderer crashes.
2. Track upstream Electron/Chromium security releases automatically and enforce
   a maximum supported-version age in CI.
3. Add a privacy/security dashboard showing site permissions, blocked requests,
   assistant reads, connector calls, and retained data by origin.
4. Complete accessibility and scaling validation across Windows, macOS, and
   Linux, including reduced motion and forced-colors mode.

## Security engineering references

- Electron security guidance: <https://www.electronjs.org/docs/latest/tutorial/security>
- Electron process sandbox: <https://www.electronjs.org/docs/latest/tutorial/sandbox>
- Electron releases and support timeline: <https://releases.electronjs.org/release/v44.2.0>, <https://www.electronjs.org/docs/latest/tutorial/electron-timelines>
- Chromium site isolation and security principles: <https://www.chromium.org/Home/chromium-security/site-isolation/>, <https://www.chromium.org/Home/chromium-security/core-principles/>

## Distribution note

The generated Windows installer is unsigned. Windows SmartScreen may warn on
first run. Signing and automatic updates are release blockers, not cosmetic
follow-up work.

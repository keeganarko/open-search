# Voyager

Voyager is a standalone, local, AI-native desktop browser for Windows,
macOS, and Linux. It combines everyday browsing, workspace organization, and an
optional Anthropic-powered assistant in one application. Browser profiles, saved credentials, memory, and settings are stored locally.
AI features send approved prompts and context to Anthropic. Voyager’s SQLite
database, including history, chat, memory and search indexes, is encrypted with
an OS-protected key. Website caches and exported files remain separate.

## Windows quick start

Install Node.js 24 or newer and Git. Linux also needs an unlocked OS keyring
(such as GNOME Keyring or KWallet); an unavailable vault stops startup. Then run:

```powershell
git clone https://github.com/keeganarko/voyager.git Voyager
cd Voyager
npm ci
npm run dev
```

Install Visual Studio Build Tools with **Desktop development with C++** and the
Windows SDK to compile the Windows Hello helper. Then build a local installer with:

```powershell
npm run dist:win
```

The installer is written to `release\Voyager-0.1.0-win-x64.exe`. Voyager
uses native Windows caption buttons and Ctrl-based shortcuts. Its local profile
is stored under `%APPDATA%\Voyager\`, with application data in
`voyager.db`. Deleting that directory performs a full local reset.

To keep Voyager on the Windows taskbar, run the installer, launch Voyager, then
right-click its taskbar icon and choose **Pin to taskbar**. The Windows build uses
a stable application ID, so the pinned shortcut continues to resolve across
normal upgrades.

Clipboard editing works through the standard **Edit** menu, keyboard shortcuts
(`Ctrl+C`, `Ctrl+V`, and `Ctrl+Shift+V`), and right-click menus in both web pages
and Voyager's own text fields.

The app can browse without an API key. To enable the assistant, open
**Settings → AI** and add an Anthropic API key. The key is protected with the
operating system's credential encryption and is excluded from sync bundles.

## Development

```bash
npm ci
npm run dev
npm run typecheck
npm test
npm run build
```

Packaging commands:

```bash
npm run dist       # macOS DMG
npm run dist:win   # Windows NSIS installer
npm run dist:linux # Linux AppImage
```

Before opening a pull request, run `npm run typecheck`, `npm test`, and
`npm run build`.

## Features

- Tabs with drag-to-reorder, pinning, muting, recently closed recovery, groups,
  and up to four resizable panes.
- Profiles with independent cookies, browsing data, history, saved logins,
  tabs, groups, permissions, zoom levels, bookmarks, and assistant memory.
- A vertical workspace rail with pinned sites, navigation, search, tabs, and
  tool panels.
- Full-text history search, bookmarks, downloads, print/PDF, find in page,
  per-origin zoom, custom new-tab and error pages, and popup support.
- Ad and tracker blocking with live blocked-request counts and runtime toggles.
- Site permission controls for camera, microphone, location, notifications,
  clipboard, screen sharing, MIDI, HID, serial, and USB.
- Saved-login capture, origin-scoped filling, reveal, and deletion using the
  operating system's credential encryption.
- Unpacked extension loading for the extension APIs supported by Electron.
- A sidebar assistant with streaming responses, visible tool steps, page and
  tab context, citations, configurable approvals, and prompt-injection guards.
- Built-in and user-created skills, local memory, daily briefs, encrypted sync,
  MCP connectors, and PowerPoint/Markdown generation.

## Opening experience

The first window in each launch can show a slow Voyager wordmark reveal with a
fine orbital trace, using the original black-on-white palette, and play a short
original synthesized signature. The complete name holds before fading to the
browser, with the opening lasting about 4.8 seconds. Clicking, typing, or scrolling
skips it; reduced-motion preferences show a brief, static version.
The animation and sound can be disabled independently in
**Settings → Appearance**, and the sound has its own volume control. No bundled
third-party media is used.

## Privacy and safety model

Every assistant tool has an action class:

| Class | Example | Default |
|---|---|---|
| `read` | Read a page or list tabs | Runs |
| `local_reversible` | Group a tab | Runs |
| `external_draft` | Prepare content or save assistant memory | Asks |
| `external_write` | Open a URL or insert text into a website | Asks |
| `sensitive` | Deletion, money, or credentials | Always asks |

Every assistant connector call, URL navigation, page insertion, and memory write
requires approval. Sensitive actions always ask. Web pages and tool outputs
remain untrusted; delimiters do not make prompt injection impossible. Websites
can transmit inserted text immediately, even without a submit click.

Interactive AI tasks ask before sharing browser context unless standing consent
is enabled in Settings → AI. Pause and excluded sites restrict future page reads.
They do not remove data already sent or stored. Hosted AI web search/fetch and
background connector access are disabled until per-call outbound controls exist.
Normal web browsing and manually approved connector calls remain available.

Sync bundles use AES-256-GCM with a scrypt-derived key. API keys, connector
secrets, and machine-local security choices are excluded. Restored connectors
remain disabled. Hosted connectors are scoped to one profile and restricted to
public HTTPS endpoints. Local connector programs are disabled until a real OS
sandbox is available.

Settings → Security shows update and threat-list status. Known malware/phishing
domains are checked locally. Downloads require HTTPS; executables and installers
are blocked. Password reveal requires supported Windows Hello or Touch ID.

Existing 0.1.0 installers remain unsigned. The new signed-update workflow needs
the owner’s production signing identities and an end-to-end release rehearsal.
Automated packaged tests do not replace independent review. See
[security operations and remaining gates](SECURITY-OPERATIONS.md) and the
[original security audit](SECURITY-AUDIT-2026-09-04.md).

## Architecture

```text
src/
  shared/      shared types and IPC channel contract
  main/
    store/     SQLite, settings, built-in skills, encrypted sync
    browser/   sessions, tabs, windows, URLs, privacy, passwords, extensions
    agent/     engine, policy, tools, context, skills, MCP, briefs, documents
    ipc.ts     renderer-to-main handlers
    menu.ts    application and page menus
  preload/
    chrome.ts  isolated window.voyager API for the app UI
    page.ts    isolated page extraction, selection, and text insertion helpers
  renderer/
    src/       application UI, sidebar, panels, overlay, and startup experience
test/          Vitest coverage with Electron and SQLite test stubs
```

Each desktop window is a `BaseWindow` containing the app UI, its visible page
views, and a transparent overlay for palettes and permission prompts. The shared
IPC table prevents main/preload drift. Each profile uses a
`persist:voyager-*` Electron session, and internal pages use the
`voyager://` scheme.

See [CLAUDE.md](../CLAUDE.md) for implementation invariants and
[docs/AUDIT.md](AUDIT.md) for the Windows port verification record.

## License

Application code: MIT — see [LICENSE](../LICENSE). Copyright © 2026 Keegan Choudhury.
The bundled HaGeZi threat data has a separate [GPL-3.0 license and notice](../resources/security/THREAT-LIST-NOTICE.md).

## Security reports and public source

Source visibility is part of Voyager's threat model. Publishing the code does not
grant access to an installed browser, and security must not rely on obscurity.
Keep personal profiles, API tokens, passwords, and signing keys out of Git.
Use [private vulnerability reporting](../SECURITY.md) for security findings.
The source/CI changes from the security audit must be reviewed and released;
existing installers do not update automatically.

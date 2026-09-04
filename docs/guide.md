# Voyager

Voyager is a standalone, local, AI-native desktop browser for Windows,
macOS, and Linux. It combines everyday browsing, workspace organization, and an
optional Anthropic-powered assistant in one application. Profiles, browsing
data, saved credentials, memory, and settings stay on the local machine.

## Windows quick start

Install Node.js 20 or newer and Git, then run:

```powershell
git clone https://github.com/keeganarko/voyager.git
cd voyager
npm ci
npm run dev
```

Build the Windows installer with:

```powershell
npm run dist:win
```

The installer is written to `release\Voyager Setup 0.1.0.exe`. Voyager
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

The first window in each launch can show the Voyager wordmark and play a
short original synthesized signature. Both can be disabled independently in
**Settings → Appearance**, and the sound has its own volume control. No bundled
third-party media is used.

## Privacy and safety model

Every assistant tool has an action class:

| Class | Example | Default |
|---|---|---|
| `read` | Read a page or list tabs | Runs |
| `local_reversible` | Open or group a tab | Runs |
| `external_draft` | Write into a field without sending | Asks |
| `external_write` | Create or send something outside Voyager | Asks |
| `sensitive` | Deletion, money, or credentials | Always asks |

Ambiguous MCP tools default to `external_write`. The `sensitive` policy cannot
be relaxed. Page content is treated as untrusted data and is delimited before
being sent to the model. Excluded sites are not read or written by assistant
tools. Voyager can draft into a field, but it has no form-submit or
message-send tool.

Sync bundles use AES-256-GCM with a scrypt-derived key. API keys and sync-target
settings are never exported. Connector subprocesses receive a minimal environment
instead of inheriting the application's full environment.

The current installer is unsigned and updates are manual. Treat this as a local
testing build rather than a primary browser until signing, automatic security
updates, malicious-site/download reputation checks, and independent review are
in place. The complete comparison and prioritized hardening roadmap are in
[the browser audit](AUDIT.md).

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

MIT — see [LICENSE](../LICENSE). Copyright © 2026 Keegan Choudhury.

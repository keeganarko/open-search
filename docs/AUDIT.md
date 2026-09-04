# Open Search — full audit

2026-09-04 · 10,902 lines across `src/` and `test/` · read in full, no sampling.
Everything below is a specific line, not a category. Severity is my judgement of
what it costs you in practice, not a rubric.

**Status: none of these are fixed yet.** This is the worklist. When you fix one,
strike the heading through and add the commit — `~~### 4. Downloads…~~ fixed in
`abc1234`` — so the next reader can tell what is live. Line numbers are as of
commit `d14828a` and will drift; the surrounding code quote is the real anchor.
Every finding was read in the source, but only the ones marked with a repro
below were reproduced at runtime — treat the rest as high-confidence reads, not
observed failures.

---

## What is actually solid

Worth saying first, because the list below is long by design and reads worse
than the codebase is.

- **The permission model is coherent.** `decide` and `check` (`permissions.ts:171,198`)
  agree on `AUTO_GRANTED`, an unknown permission string is denied rather than
  granted, an excluded site is refused before it can prompt, and a request whose
  tab dies resolves to `false` instead of leaving the page's promise hanging.
  That last one is the kind of thing most hobby browsers get wrong.
- **Passwords never touch disk in plaintext**, and `loginFill` (`ipc.ts`) checks
  that the active tab's origin matches the stored origin before sending the
  secret to the page. The secret goes main → page preload directly and never
  through the chrome renderer.
- **The sync bundle is real crypto** — scrypt N=2^15 + AES-256-GCM, and it strips
  `ai.apiKey` and `sync` on import so a bundle cannot overwrite machine-local
  secrets.
- **Tab views are `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.**
  The chrome and overlay are the only unsandboxed renderers, and they load local
  files only.
- The 61 tests cover the parts where a mistake is silent: url resolution, action
  classes, the approval policy, the exclusion list, bundle crypto, permission
  ordering.

---

## Bugs — things that are wrong right now

### 1. The composer can lock up forever · `agent/engine.ts:242, 272`

Two exits from the tool loop set `assistant.error` and `break` without emitting
anything:

```ts
if (message.stop_reason === 'refusal') {
  assistant.error = 'The model declined this request.'
  break                                   // ← no emit
}
...
if (guard >= 24 && !assistant.error) {
  assistant.error = 'Stopped after 24 tool rounds without finishing.'
}                                          // ← no emit
```

`Sidebar.tsx:74-80` clears `streamingId` only on `done` or `error`. So on a
refusal or a 24-round runaway the send button stays a stop button, `busy` stays
true, and the only way out is a new window. **Highest-value fix in this list:**
emit an `error` event on both paths.

### 2. Theme change throws after you close a window · `browser/window.ts:127`

Every `KiaWindow` adds a listener to the process-global `nativeTheme` and nothing
ever removes it. Close a window, then let macOS flip to dark at sunset: the dead
window's listener calls `setBackgroundColor` on a destroyed `BaseWindow`. It also
leaks one listener per window opened for the life of the process. Needs the
handler stored and removed in the `closed` handler.

### 3. The 12-second splash timer outlives its window · `browser/window.ts:310`

`beginSplash` schedules `setTimeout(() => this.endSplash(), 12_000)` as a floor.
`endSplash` calls `layout()`, which calls `this.window.getContentSize()`. Quit or
close within twelve seconds of launch and that throws into `uncaughtException`.

### 4. Downloads silently overwrite each other · `browser/session.ts:103`

```ts
const target = join(app.getPath('downloads'), item.getFilename())
item.setSavePath(target)
```

Two `invoice.pdf` downloads produce one file. Chrome writes `invoice (1).pdf`.
Calling `setSavePath` at all is what disables Chromium's own uniquifier — you
have to reimplement it.

### ~~5. The new-tab page does not exist~~ — half fixed · `browser/tabs.ts:20, 96`

`kia://new-tab` is a sentinel string. No protocol is registered for it and
`create()` explicitly skips loading it, so a new tab is still a blank
`WebContentsView` — **that part stands.**

~~Worse, `tab.state.url` is still `kia://new-tab`, and the toolbar renders the
host of any truthy URL — so a brand-new tab shows `new-tab` in the address bar
instead of its placeholder.~~ Fixed: `create()` now stores `''` for the sentinel,
so the omnibox shows its placeholder and the reopen-tab stack stops collecting
sentinels. Confirmed in a running window before and after.

What remains is the real new-tab page: register the scheme and serve something.

### 6. A pending approval can wedge the agent · `agent/engine.ts:342`

The approval promise is resolved by `respondToApproval` or by `stop()`. Nothing
resolves it if the window closes with the sheet open — the `send()` call never
returns and the entry sits in `pendingApprovals` forever. `cancelFor(win)` exists
for exactly this in the permission code; the agent needs the equivalent.

### 7. Off-by-one on the round guard · `agent/engine.ts:272`

`while (guard++ < 24)` leaves `guard === 25` after the 24th body runs, so a run
that *finishes* on round 24 gets "Stopped after 24 tool rounds without finishing"
stapled to a complete answer.

### 8. Blocked-request counts double per profile · `browser/adblock.ts:36`

`blocker.on('request-blocked', …)` is registered inside `attachBlocker`, which
runs once per session — but there is one shared blocker. Two profiles, two
listeners, every count doubled. Moot in practice only because nothing reads the
counter (see §18).

---

## Privacy and security

### 9. The API key can land in SQLite as plaintext · `store/settings.ts:118`

```ts
if (safeStorage.isEncryptionAvailable()) { … } else { kvSet(API_KEY, `plain:${key}`) }
```

`passwords.ts:12` takes the opposite and correct line — "refusing to save beats
writing plaintext and calling it a password manager." This is the same decision
made the other way for a credential that can spend money. It matters now that
you are moving to other machines: `safeStorage` is DPAPI on Windows (fine) but
depends on libsecret/kwallet on Linux, and a headless or minimal desktop has
neither. **Recommendation:** refuse and say so, exactly like passwords do.

### 10. Deleting a profile leaves almost everything behind · `store/db.ts:202`

`profileDelete` (`ipc.ts`) does clear the session partition — cookies and cache
go. But only `tab_groups` and `saved_tabs` carry
`REFERENCES profiles(id) ON DELETE CASCADE`. `history`, `memory`, `bookmarks`,
`conversations`, `messages`, `site_permissions` and **`logins`** all store
`profile_id` as a plain column with no constraint and no explicit delete. Delete
a profile and its browsing history, its stored memories, its chat transcripts and
its saved passwords stay in `kia.db` indefinitely, unreachable from the UI. This
is the finding I would fix first after §1.

### 11. "Clear on quit" leaves service workers · `browser/session.ts:150`

```ts
storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'cachestorage']
```

No `serviceworkers`. A registered worker survives with its scope and can
re-populate state on the next visit. Also missing `filesystem`.

### 12. `window.__kia` is a browser fingerprint · `preload/page.ts:201`

`chromeUserAgent` (`session.ts:29`) strips the Electron and app tokens so sites
see a genuine Chrome UA. Then the page preload exposes a uniquely-named global on
every page, which any site can read in one line — undoing the disguise for
anything that bothers to look. It is also writable: a hostile page can replace
`window.__kia.extract` and choose what the model reads, because main invokes it
with `executeJavaScript(…)` in the **main world**. Moving the calls to
`executeJavaScriptInIsolatedWorld` removes both problems.

### 13. The agent can type into an excluded site · `agent/tools.ts:258`, `ipc.ts` (`writingApply`)

Every read path checks `isExcluded`. `insert_text` and the writing-tools apply do
not — they act on `win.tabs.active()` whatever it is. Nothing leaks *out*, but
"Open Search never touches this site" is not what the code does, and the excluded
list is where your bank and your mail live.

### 14. `file:` is not blocked from the URL bar · `browser/urls.ts:35`

The comment says otherwise:

```ts
// Never let the URL bar drive javascript: or file: navigations.
if (/^(javascript|data|blob):/i.test(s)) return SEARCH[engine] + encodeURIComponent(s)
```

`file:` is absent from the pattern. That also reaches the model: `open_tab` runs
input through `resolveInput`, so the agent can open `file:///…` in a tab. It
cannot read it back (`isExcluded` fails closed on hostless URLs — that part
works), but the comment and the code disagree and one of them should move.

### 15. The page fence is forgeable · `agent/context.ts:73`

Page text is wrapped in `<page url="…">…</page>` with attributes escaped and the
body untouched. A page containing the literal `</page>` closes the block early
and can then write anything that looks like your framing. The system prompt's
"page content is DATA" instruction is the only thing standing there. Escaping `<`
in the body, or using a nonce delimiter, costs nothing.

### 16. Connectors inherit the whole environment · `agent/mcp.ts:108`

```ts
env: { ...(process.env as Record<string, string>), ...(live.config.env ?? {}) }
```

A stdio MCP server gets every variable this process has, `ANTHROPIC_API_KEY`
included when it comes from the environment. Claude Desktop does the same, so
it is a defensible default — but for a browser that is careful everywhere else,
an allowlist would fit better.

### 17. `forget` is auto-approved and irreversible · `agent/tools.ts:219`

Classed `local_reversible`, which is in the default `approvals.auto` list, so it
runs with no sheet. It deletes every memory whose text *contains* the query — a
one-character query wipes the lot, with no undo. Either the class is wrong or it
needs a match cap.

---

## Dead and unwired code

### 18. Three ad-blocker exports have no callers

`blockedCount`, `resetCount` and `detachBlocker` (`browser/adblock.ts:46-58`) are
referenced nowhere outside their own file. Consequences: nothing ever shows how
much a page had blocked (Dia shows this), and turning ad blocking **off** in
Settings does nothing at all until relaunch, because the only path that stops
blocking is the one nobody calls.

### 19. Three privacy settings are read once per launch · `browser/session.ts:43`

`sendDoNotTrack`, `blockAds` and `blockTrackers` are consulted when a partition
is first configured and never again. The toggle moves, the setting persists, and
behaviour does not change until restart — with no note saying so.

### 20. Unused imports · `main/index.ts:1-2`

`session` and `dirname` are imported and never used. Harmless; noted because
`noUnusedLocals` is evidently off, which is what let §18 and §19 hide.

---

## Drift from your own stated invariants

### 21. Eight IPC channels bypass the `IPC` table

`CLAUDE.md` says: *"Any channel with a reply goes in the `IPC` table before you
use it, so main and renderer cannot drift on a name."* These are `handle()`d as
string literals in `ipc.ts`:

`kia:skill-reset` · `kia:history-forget-domain` · `kia:reveal-file` ·
`kia:sync-filename` · `kia:downloads-clear` · `kia:clipboard-write` ·
`kia:excluded` · `kia:window-state`

Each is matched by a hand-typed literal in `preload/chrome.ts`. The typecheck
that protects the other ~90 channels does not protect these eight.

---

## Behaviour gaps vs. Chrome and Dia (not bugs — missing work)

22. **Reopen-closed-tab is thin.** The stack lives in the renderer
    (`App.tsx:88`), is derived by diffing state, holds URLs only, and is lost on
    quit. Chrome restores the tab with its history and scroll position, across
    sessions. A profile switch also pushes every tab of the old profile onto the
    stack, so ⌘⇧T after switching reopens the other profile's page in the new
    one.
23. **No per-origin zoom memory.** `setZoom` is per tab and forgotten on close.
24. **No error page.** `did-fail-load` raises a toast and the tab keeps showing
    whatever was there before. Chrome replaces the document.
25. **Popups become tabs with no opener** (`tabs.ts:399`). Deliberate, and right
    for most popups — but an OAuth "Sign in with…" window that posts its result
    back through `window.opener.postMessage` will hang, because the new tab has
    no opener. This will bite on real sites.
26. **Switching profiles leaves the sidebar thread open**, so the next message
    continues the old profile's conversation under the new profile.

---

## Priority, if you only do some of it

1. §1 — the stuck composer. Cheap, and it is the one that will happen to you.
2. §10 — profile deletion leaving passwords and history behind.
3. §9 — plaintext key fallback, before the Windows/Linux installs multiply.
4. §5 — the new-tab page, because you will see it every single day.
5. §2, §3 — the two destroyed-window throws.
6. §19 — settings that silently do nothing are worse than settings that are absent.

# Chrome import and browser UI audit

Audited and implemented on 2026-09-04. This is a source audit of browser data,
UI, persistence, preload/IPC, profiles, assistant context, and adjacent runtime
controls. It is not an independent security certification or a claim of Dia or
Chrome feature parity. Existing [security release requirements](SECURITY-OPERATIONS.md)
still apply.

## Findings and changes

| Area | Finding | Result |
|---|---|---|
| Browser layout | Navigation, tabs, and favorites lived in a left rail; Electron reserved a left content inset. | Horizontal tabs, toolbar, bookmarks bar, native profile/menu controls, and an optional right assistant. Both renderers use shared dimensions from `src/shared/chromeLayout.ts`. |
| Import | Existing encrypted sync bundles only moved Voyager data. No Chrome source discovery or import existed. | Windows, macOS, and Linux Chrome profile detection, a native folder chooser, selected categories, counts preview, explicit commit, and completion counts. |
| Bookmarks | Existing profile-owned bookmarks and favorites were reusable, but the assistant had no saved-bookmark search. | Import Chrome JSON or bookmark HTML with folder paths and creation dates. Address-bar suggestions and the `search_bookmarks` assistant tool search titles, URLs, and folders. |
| History | Existing full-text history could index imported rows, but normal insertion replaced visit dates with the current time. | Read Chrome's `History` database with a read-only SQLite connection, including WAL data. Import each URL's last visit with its original date and index it with the existing FTS triggers. |
| Passwords | The encrypted vault supports a login per profile, origin, and username. It cannot decrypt Chrome's protected vault. | Import an explicitly selected Chrome password CSV; separately encrypt each password and store it in the encrypted app database. Existing matching logins are preserved. |
| Panels | React panels could paint underneath native web page views. | Detach page views while a panel is open and reattach beneath the overlay when it closes. |
| Narrow windows | A previously expanded assistant could reserve more than a narrowed window could fit. | Clamp its effective width so the page keeps at least 320 pixels. |
| Keyboard commands | Print and the command palette both used Ctrl/Cmd+P. | Print keeps Ctrl/Cmd+P; palette moves to Ctrl/Cmd+Shift+L; Ctrl/Cmd+Shift+B toggles bookmarks. |
| Profiles | The underlying APIs existed; profile management was hard to reach. | Native profile switcher and a profile creation panel. Imports target the current profile and cancel on profile changes. |

## What transfers

| Chrome / Google data | Support in this change |
|---|---|
| Bookmarks | Local Chrome profile, Chrome bookmark JSON, or Chrome bookmark HTML export. HTTP(S) links only; folder paths are retained as text. |
| Browsing history | Local Chrome profile. Latest visit per URL, at most the 50,000 most recent URLs; no page body or historical visit count. Exclusions and current retention apply at preview and commit. |
| Saved passwords | Chrome CSV export: URL, username, password. HTTPS and loopback HTTP only. Blank usernames, Android credentials, invalid rows, and duplicate logins are skipped. Password notes are not stored. |
| Multiple Chrome profiles | Import separately into chosen Voyager profiles. Only the selected profile and categories are read. |
| Google-account-only bookmarks/history | First sync into Chrome locally, then import. |
| Google Chrome Sync | No continuous Google account sync. Google's private Chrome APIs are restricted to Google Chrome. [Chromium announcement](https://blog.chromium.org/2021/01/limiting-private-api-availability-in.html). |
| Cookies and existing website sign-ins | Not imported. Sign in again in Voyager. Chrome's OS protection, including application-bound cookie encryption on Windows, makes raw profile copying unsuitable as a general migration mechanism. [Google security explanation](https://security.googleblog.com/2024/07/improving-security-of-chrome-cookies-on.html). |
| Extensions | Not imported. Voyager's existing unpacked-extension loader remains limited to Electron's supported APIs. |
| Open tabs and Chrome settings | Not imported. Voyager's own tab/session restore and settings continue separately. |
| Addresses, payment cards, passkeys | Not imported; Voyager has no corresponding migration/storage workflow. |
| Google Collections, saved Maps places, Drive/Gmail contents, Google Takeout archives | Not imported. These are separate account datasets, rather than Chrome bookmark/history files. |

Dia advertises broader migration coverage, including extensions and multiple
profiles. This implementation does not claim to reproduce that entire matrix.
[Dia migration description](https://www.diabrowser.com/download/thanks).

## Data flow and safeguards

1. Privileged UI requests discovery or opens a native file chooser. The public
   contract in `src/shared/browserImport.ts` carries opaque source IDs, names,
   category availability, counts, and warnings. It never returns source paths,
   imported history rows, usernames, or password values in a preview.
2. Main reads only selected sources. Text reads are capped at 32 MiB, bookmark
   and password imports at 50,000 records, and bookmark nesting at 100 levels.
   HTML is parsed as inert text; no imported page is opened or fetched.
3. Preview stages parsed records in main memory for ten minutes, bound to the
   originating window and destination profile. Cancel, close, expiry, or a
   profile change drops the staged job. Cancelled asynchronous work cannot leave
   a usable preview behind.
4. Commit rechecks the destination and history privacy rules. A transaction
   inserts only new records. Bookmark duplicates match profile + normalized URL;
   history duplicates also match the last-visit date; passwords match origin +
   username. Matching existing records are kept. Retrying an identical import
   adds no duplicates; a later visit to the same URL is a new history record.
5. Passwords pass through the operating system's protected encryption before
   storage; the application database is also encrypted. No plaintext staging
   file or copied Chrome database is created. Password CSVs selected by the user
   remain on disk until the user deletes them.
6. Imports do not enable AI consent or create inferred memories. Assistant
   bookmark/history search uses the current profile, honors pause/exclusions,
   and escapes source text. The ordinary AI consent prompt now names bookmarks.
   Passwords are never offered as assistant tools or context.

Discovery uses Chrome's documented stable-channel directories; custom paths and
other channels can be selected manually. [Chromium user-data directory reference](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/user_data_dir.md).
Chrome may need to be closed if its history file is locked or inaccessible.

## Validation

- `npm run typecheck` and `npm run build` passed; `npm test` passed all 149 tests
  across 24 files.
- New unit tests cover bookmark hierarchy, HTML decoding, executable URLs,
  Chrome timestamp conversion, CSV quoting/BOM/newlines, invalid rows, parser
  limits, profile isolation, cancellation, single-use previews, and private
  bookmark context filtering.
- Window-layout tests cover 120/88-pixel toolbar placement, page detachment and
  restoration for panels, overlay ordering, and narrow split/sidebar bounds.
- `node scripts/test-browser-import.mjs` exercises real native SQLite: an open
  WAL source, original dates, a read-only source, preview without writes, FTS
  indexing, deduplication, destination isolation, credential preservation,
  transaction rollback, and encrypted database bytes. Its OS credential store
  is simulated; it does not verify Windows Hello or a real OS vault.
- Headless Chromium renderer checks used synthetic data and a mocked preload:
  import selection → preview → completion, 1440- and 720-pixel widths, exact
  toolbar heights, panel visibility messages, and no renderer exceptions.
- A normal isolated Electron launch was attempted on this WSL host. The host
  has no secure system keyring; `safeStorage.isEncryptionAvailable()` returned
  false, so the app correctly refused to open. Full native interaction and
  real Chrome profile migration still need validation on the target OS.

## Native acceptance check

On the target machine, launch the current source with `npm run dev`. Linux needs
an unlocked supported keyring. Create a temporary Voyager profile from **Profile
→ Manage profiles**, then use a Chrome profile with known test bookmarks/history.
Review and import, repeat to check duplicate counts, search the imported title
in the address bar, and restart to check persistence. Import a test credential
CSV separately and verify its saved-login entry and origin-scoped fill. Check
native caption controls, tab dragging, menus, panels, splits, and fullscreen on
Windows and macOS. No existing installed binary is updated by changing source.

# 986Code Bridge for ChatGPT

A user-controlled Chromium browser automation bridge developed by **AbeyyTechXy**.

**Current release:** `v0.1.0-alpha.4`
**Status:** Alpha / working browser bridge; native companion remains optional and incomplete.

986Code lets a user pass structured commands to a browser extension to inspect pages, manage tabs, click, type, tick controls, scroll, read values, and optionally use Chromium DevTools Protocol or a future native/SSH companion.

> This is a third-party project. It is not affiliated with, endorsed by, or maintained by OpenAI, Opera Software, Anthropic, or Google.

## Design principles

- **User controlled** — commands execute only in the browser profile where the extension is installed.
- **Fail closed** — page commands do not silently fall back to an old tab.
- **Explicit target for remote control** — automation from an extension command page should provide a `tabId`.
- **User-owned identity** — each installation uses that user's own browser and ChatGPT session; 986Code provides no shared account.
- **No hardcoded credentials** — no user password, private key, API token, session cookie, or personal host is embedded in source.
- **Native-owned secrets** — SSH passwords, passphrases, private-key material and tokens belong in the OS/native credential layer, not extension storage.
- **Redacted local audit history** — local history keeps operation metadata while typed values, SSH commands, credential fields and URL query/hash data are redacted.
- **Explicit elevated modes** — Chromium/Edge requires `debugger` as a declared required permission for CDP Power Mode; `nativeMessaging` remains optional.

## Verified in v0.1.0-alpha.2

| Capability | Status |
|---|---|
| List browser tabs | PASS |
| Explicit tab targeting | PASS |
| Inject page bridge on HTTP/HTTPS | PASS |
| Inspect/read DOM | PASS |
| Type into input | PASS |
| Check/uncheck checkbox | PASS |
| Click element | PASS |
| End-to-end click callback | PASS |
| Read-back after mutation | PASS |
| Unsafe remembered-tab fallback | BLOCKED by default |

The release validation used an isolated localhost fixture. The final read-back returned `DONE:986Code-alpha2-E2E:true` and the test server received the corresponding callback.
## Installation (unpacked extension)

1. Clone or download this repository.
2. Open your Chromium-based browser extension manager (for Opera GX: `opera://extensions`).
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the repository's `extension/` directory.
6. Pin **986Code Bridge** if you want quick access to its popup.

The extension requests HTTP/HTTPS host access because remote commands may target an already-open web tab without a direct user click on that tab. File URL access remains controlled by the browser's extension settings.

## Safe targeting model

For remote commands, first list tabs and then address the intended page by ID:

```json
{ "target": "browser", "action": "tab.list" }
```

Then use the returned `tabId`:

```json
{ "target": "page", "action": "read", "tabId": 123, "selector": "body" }
```

If the active tab is an extension/internal browser page and no `tabId` is supplied, v0.1.0-alpha.2 fails closed. The old automatic remembered-tab fallback is disabled unless a caller explicitly sends `"allowRememberedTab": true`.

## Core command examples

```json
{ "target": "page", "action": "inspect", "tabId": 123, "limit": 20 }
{ "target": "page", "action": "type", "tabId": 123, "selector": "#email", "value": "user@example.com" }
{ "target": "page", "action": "check", "tabId": 123, "selector": "#agree" }
{ "target": "page", "action": "click", "tabId": 123, "text": "Continue" }
{ "target": "browser", "action": "tab.reload", "tabId": 123 }
```

Batch commands are executed sequentially and stop on the first failure by default.
## Targets

- `page` / `web` — DOM-level automation through `bridge-content.js`.
- `browser` / `tab` — tab listing, creation, activation, closing, navigation, reload, screenshot.
- `cdp` / `power` — optional coordinate-level input through the Chromium debugger permission.
- `native` / `ssh` / `terminal` — optional Native Messaging path for a local companion.

The Native Messaging integration point is present, but the native companion is **not bundled as a finished component in this release**. Do not treat SSH/native mode as production-ready yet.

## Permissions

| Permission | Why it is used |
|---|---|
| `activeTab` | Read the browser's active tab when a local popup action is used |
| `tabs` | List, activate, navigate, reload, create and close tabs |
| `scripting` | Inject the page bridge into approved HTTP/HTTPS pages |
| `storage` | Settings, SSH profile metadata and local command history |
| HTTP/HTTPS hosts | Permit explicit automation of already-open web tabs |
| `debugger` | CDP Power Mode; required because Chromium/Edge rejects it in `optional_permissions` |
| `nativeMessaging` (optional) | Local native/SSH companion |

## Security notes

- Never put passwords, cookies, session tokens, private keys, or API tokens in the repository.
- Prefer explicit `tabId` for any remote or destructive workflow.
- Treat page mutations as state-changing operations: inspect first, execute the intended action once, then read back the result.
- Browser-protected pages such as `chrome://` / `opera://` cannot be controlled through the normal DOM bridge.
- Host permissions are powerful. Install this extension only from source you trust and review.

See [SECURITY.md](SECURITY.md) for reporting and operational guidance, [PRIVACY.md](PRIVACY.md) for data handling, and [docs/SECURITY_ARCHITECTURE.md](docs/SECURITY_ARCHITECTURE.md) for the trust and identity boundary.

## Repository layout

```text
extension/                 Browser extension source
.github/workflows/ci.yml   Source validation only; no build artifacts
CHANGELOG.md               Version history
CONTRIBUTING.md            Contribution workflow
docs/COMMAND_REFERENCE.md  Command and targeting reference
LICENSE                    MIT license
PRIVACY.md                 User-owned identity and data-handling policy
SECURITY.md                Security policy
```

GitHub is used for **source, versioning, CI and releases**. Compiled/binary build history should not be stored in this repository.
## Development and validation

The extension has no runtime npm dependency. Basic source validation can be performed with:

```powershell
node --check extension\background.js
node --check extension\bridge-content.js
node --check extension\command.js
node --check extension\options.js
node --check extension\popup.js
```

The CI workflow also parses `manifest.json` and checks all JavaScript files for syntax errors. It intentionally does not upload artifacts.

## Roadmap

- Harden tab-selection UX and command provenance.
- Add structured operation IDs and clearer audit events.
- Build and independently version the native companion.
- Add authenticated native IPC and stricter SSH profile validation.
- Add automated browser integration tests.
- Package browser-store-ready releases after the alpha API stabilizes.

## License

Source code is licensed under the [MIT License](LICENSE).

The MIT grant does not grant trademark rights to the **AbeyyTechXy** or **986Code** names, logos, or branding.

Copyright © 2026 AbeyyTechXy.

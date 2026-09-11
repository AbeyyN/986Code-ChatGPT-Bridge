# 986Code Bridge for ChatGPT

A user-controlled Chromium browser automation bridge developed by **AbeyyTechXy**.

**Current release:** `v0.1.0-alpha.5`
**Status:** Alpha / development-ready browser bridge with a Windows native control plane, CLI, MCP adapter, and installer.

986Code lets a user pass structured commands to a Chromium extension to inspect pages, manage tabs, click, type, tick controls, scroll, read values, use optional CDP power tools, and route local automation through an authenticated Windows native control plane.

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

## Verified capabilities

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
| Authenticated 127.0.0.1 native control plane | PASS |
| PERSONAL / WORK multi-profile isolation | PASS |
| READ / WRITE / POWER tier enforcement | PASS |
| Standalone CLI and MCP adapter | PASS |
| Native SSH via working OpenSSH discovery | PASS |
| Installer install/uninstall round trip | PASS |

Browser validation uses isolated localhost fixtures. Alpha.5 additionally passed live PERSONAL/WORK profile isolation, MCP-to-browser mutation/readback, native-binary SSH execution, and a clean installer uninstall/reinstall round trip.
## Installation (unpacked extension)

1. Clone or download this repository.
2. Open your Chromium-based browser extension manager (for Opera GX: `opera://extensions`).
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the repository's `extension/` directory.
6. Pin **986Code Bridge** if you want quick access to its popup.

The extension requests HTTP/HTTPS host access because remote commands may target an already-open web tab without a direct user click on that tab. File URL access remains controlled by the browser's extension settings.

### Windows native control plane

Build the binaries and installer with:

```powershell
powershell -ExecutionPolicy Bypass -File installer\build-native.ps1
powershell -ExecutionPolicy Bypass -File installer\build-setup.ps1
```

For an unpacked extension, install with its actual Chromium extension ID:

```powershell
.\dist\installer\986CodeBridge-Setup.exe --extension-id <32-character-extension-id>
```

The installer is per-user, registers the Native Messaging host for Chrome, Edge and Opera, installs `986code.exe` and `986code-mcp.exe`, and binds the control plane only to `127.0.0.1`.

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
- `native` / `ssh` / `terminal` — Native Messaging path to the Windows control-plane companion.
- `mcp` — local stdio MCP adapter exposing explicit per-instance browser tools and SSH.

Alpha.5 bundles the Windows native host, CLI and MCP adapter through `986CodeBridge-Setup.exe`. Native SSH requires a working OpenSSH client; 986Code validates candidates and can use Git for Windows OpenSSH when the Windows client is broken or unavailable.

## Permissions

| Permission | Why it is used |
|---|---|
| `activeTab` | Read the browser's active tab when a local popup action is used |
| `tabs` | List, activate, navigate, reload, create and close tabs |
| `scripting` | Inject the page bridge into approved HTTP/HTTPS pages |
| `storage` | Instance identity, permission settings and redacted local audit metadata |
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
native/                    Windows native host + CLI source
mcp/                       Local stdio MCP adapter
installer/                 Windows SEA build/install tooling
tools/                     Security/native/MCP self-tests
.github/workflows/ci.yml   Source validation and build smoke tests; no uploaded artifacts
CHANGELOG.md               Version history
CONTRIBUTING.md            Contribution workflow
docs/COMMAND_REFERENCE.md  Command and targeting reference
LICENSE                    MIT license
PRIVACY.md                 User-owned identity and data-handling policy
SECURITY.md                Security policy
```

GitHub is used for **source, versioning, CI and releases**. Compiled/binary build history should not be stored in this repository.
## Development and validation

Install development dependencies and run the portable validation suite with:

```powershell
npm ci
npm test
npm run build:mcp
```

Extension-only syntax validation can also be performed with:

```powershell
node --check extension\background.js
node --check extension\bridge-content.js
node --check extension\command.js
node --check extension\options.js
node --check extension\popup.js
```

The CI workflow also parses `manifest.json` and checks all JavaScript files for syntax errors. It intentionally does not upload artifacts.

## Roadmap

- Add first-run onboarding and automatic browser/profile labelling.
- Add structured operation IDs and clearer command provenance.
- Improve permission approval and health-status UX.
- Add MCP configuration helpers for supported local MCP clients.
- Expand Chrome / Edge / Opera compatibility automation.
- Add code signing and browser-store-ready packaging after the alpha API stabilizes.

## License

Source code is licensed under the [MIT License](LICENSE).

The MIT grant does not grant trademark rights to the **AbeyyTechXy** or **986Code** names, logos, or branding.

Copyright © 2026 AbeyyTechXy.

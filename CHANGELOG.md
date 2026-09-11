# Changelog

All notable changes to **986Code Bridge for ChatGPT** are documented here.

The project uses semantic versioning while the command API is still in alpha.

## [Unreleased]

### Planned
- First-run onboarding, automatic instance labelling, and clearer connection health UX.
- Stronger command provenance and operation IDs.
- Broader automated Chrome / Edge / Opera compatibility coverage.

## [0.1.0-alpha.5] - 2026-09-10

### Added
- Authenticated per-instance control plane bound exclusively to `127.0.0.1`.
- Per-profile UUID/label isolation with READ, WRITE and POWER permission tiers.
- Standalone Windows native host and `986code` CLI.
- Local stdio MCP adapter with explicit instance selection for every browser/SSH operation.
- Standalone `986code-mcp.exe` and `986CodeBridge-Setup.exe` packaging.
- Native SSH profile execution using SSH Agent or key-file references without storing passwords.

### Security
- Removed URL-query command payload execution from the extension command page.
- Bearer tokens are generated per native-host instance and are not stored in extension storage.
- Native host independently enforces POWER for SSH.
- Installer registers only the explicitly supplied unpacked extension ID; no maintainer session or credential is bundled.
- Native SSH discovers and validates a working OpenSSH client instead of blindly trusting a broken PATH entry.

### Verified
- CLI -> Native Host -> Opera -> real webpage mutation/readback.
- Simultaneous PERSONAL-OPERA / WORK-OPERA operation and cross-profile tab isolation.
- POWER-denied behavior when the elevated tier is disabled.
- MCP source and standalone binary protocol tests plus live MCP-to-browser E2E.
- Rebuilt native-host executable -> isolated key-authenticated SSH server E2E.
- Standalone installer uninstall/reinstall round trip with production-only Native Messaging origin.

## [0.1.0-alpha.4] - 2026-09-10

### Fixed
- Chromium/Edge manifest error caused by declaring `debugger` in `optional_permissions`.
- CDP Power Mode now receives the required `debugger` permission at install/reload time.
- Power Mode settings no longer present the required debugger permission as user-toggleable.
- Added regression checks preventing `debugger` from returning to `optional_permissions`.

## [0.1.0-alpha.3] - 2026-09-09

### Added
- Explicit user-owned identity policy: each installation uses the user's own browser/ChatGPT session.
- Native-owned credential boundary for SSH and future local integrations.
- Security architecture documentation and privacy schema migration.

### Security
- Inline password, token, passphrase, cookie, API-key and private-key fields are blocked from native commands.
- SSH profile storage is restricted to non-secret metadata.
- Local command history now stores redacted metadata; typed values, SSH commands, profile payloads and URL query/hash data are removed.
- Legacy alpha command history is cleared once during privacy migration.

## [0.1.0-alpha.2] - 2026-09-09

### Added
- HTTP/HTTPS host permissions required for explicit automation of already-open tabs.
- Explicit `tabId` targeting for remote page commands.
- Opt-in `allowRememberedTab` override for callers that intentionally want remembered-tab fallback.
- Local isolated end-to-end validation fixture.

### Changed
- Remote target resolution now fails closed when the active page is browser-internal or extension-owned and no explicit `tabId` is supplied.
- Extension metadata bumped to `version_name: 0.1.0-alpha.2` and Chromium numeric version `0.1.0.2`.

### Verified
- Tab listing.
- HTTP/HTTPS bridge injection.
- DOM inspect/read.
- Input typing.
- Checkbox check/uncheck.
- Element click.
- Server callback after click.
- Read-back result `DONE:986Code-alpha2-E2E:true`.
## [0.1.0-alpha.1] - 2026-09-09

### Added
- Manifest V3 browser extension baseline.
- DOM page bridge for inspect, click, type, check, uncheck, select, scroll, key, submit and read actions.
- Browser tab list/create/activate/close/reload/navigate commands.
- Optional CDP Power Mode hooks.
- Optional Native Messaging / SSH integration hooks.
- Local command history and SSH profile metadata UI.
- Command URL runner and extension popup.

### Known issue
- The original remote command-page flow could reuse a remembered web tab when the command page itself was active. This was unsafe for unattended automation and was corrected in `0.1.0-alpha.2`.

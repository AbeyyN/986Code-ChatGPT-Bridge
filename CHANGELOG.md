# Changelog

All notable changes to **986Code Bridge for ChatGPT** are documented here.

The project uses semantic versioning while the command API is still in alpha.

## [Unreleased]

### Planned
- Native companion hardening and packaging.
- Automated browser integration tests.
- Stronger command provenance and operation IDs.

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

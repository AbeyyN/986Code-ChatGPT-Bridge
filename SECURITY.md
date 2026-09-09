# Security Policy

## Supported versions

Security fixes are applied to the latest development release. Pre-release builds may change quickly and should not be treated as hardened production software.

| Version | Supported |
| --- | --- |
| 0.1.x alpha | Yes |
| Older builds | No |

## Reporting a vulnerability

Do **not** publish exploitable security details in a public issue. Use GitHub's private vulnerability reporting feature for this repository when available, or contact the maintainer privately through the verified channels on the GitHub profile.

Please include the affected version, browser/OS, reproduction steps, expected behaviour, actual behaviour, and the minimum proof required to demonstrate impact.

## Security model

986Code Bridge is user-controlled. Browser mutations should target an explicit tab where possible. Commands fail closed when a safe target cannot be resolved. SSH/native secrets must remain on the native side and must never be committed to this repository.

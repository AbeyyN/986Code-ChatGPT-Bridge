# Security Architecture

## Trust boundary

986Code Bridge is an executor, not an identity provider. Each browser installation is isolated and uses the account/session already owned by that user.

```text
User ChatGPT / AI account
        |
User browser profile + session
        |
986Code Bridge extension
        |
Optional user-owned native companion
        |
OS credential store / SSH agent / user key file
```

## Rules

1. No shared 986Code ChatGPT account is embedded or proxied.
2. No AbeyyTechXy/OpenAI API key is bundled in public source or release packages.
3. Browser cookies and login tokens stay inside the user's browser profile.
4. SSH passwords, key passphrases, tokens and private-key material stay in the native/OS credential layer.
5. Extension storage may hold only non-secret SSH profile metadata such as host, port, username, auth method and key-path reference.
6. Local audit history is metadata-redacted by default and never stores typed values or SSH command bodies.
7. Future direct API integrations must use per-user authorization or BYOK; a maintainer-owned shared key is prohibited.

## Multi-user behaviour

Installing the extension on another computer or browser profile does not grant access to the maintainer's ChatGPT, Opera, SSH or browser sessions. The new installation starts with its own isolated extension storage and uses that user's own sessions and credentials.

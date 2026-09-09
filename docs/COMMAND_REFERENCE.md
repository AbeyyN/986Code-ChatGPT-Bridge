# Command Reference

Commands use a small JSON envelope. The active development build supports `page`, `browser`, `cdp`, `native`, `ssh`, and `terminal` targets.

## Page commands

```json
{ "target": "page", "action": "click", "tabId": 123, "selector": "#save" }
{ "target": "page", "action": "type", "tabId": 123, "selector": "#name", "value": "986Code", "clear": true }
{ "target": "page", "action": "check", "tabId": 123, "selector": "#agree" }
{ "target": "page", "action": "read", "tabId": 123, "selector": "#status" }
{ "target": "page", "action": "inspect", "tabId": 123, "limit": 20 }
```

Prefer explicit `tabId` for mutations. If no explicit tab is supplied, the bridge only uses the currently active scriptable web tab. It does not silently fall back to a remembered web tab unless `allowRememberedTab` is explicitly enabled.

## Browser commands

```json
{ "target": "browser", "action": "tab.list" }
{ "target": "browser", "action": "tab.new", "url": "https://example.com" }
{ "target": "browser", "action": "tab.activate", "tabId": 123 }
{ "target": "browser", "action": "tab.reload", "tabId": 123 }
{ "target": "browser", "action": "tab.close", "tabId": 123 }
```

## Power/CDP commands

These require the optional `debugger` permission.

```json
{ "target": "cdp", "action": "cdp.click", "tabId": 123, "x": 420, "y": 300 }
{ "target": "cdp", "action": "cdp.type", "tabId": 123, "text": "hello" }
{ "target": "cdp", "action": "cdp.key", "tabId": 123, "key": "Enter" }
```

## Native and SSH commands

These require the optional `nativeMessaging` permission and an installed companion host.

```json
{ "target": "ssh", "action": "ssh.exec", "profile": "Pi", "command": "uname -a" }
```

SSH profiles contain connection metadata only. Passwords and private key material should remain under OS/native control.

## Batch execution

The command ingress accepts an array and executes in sequence. By default, batch execution stops on the first failed command.

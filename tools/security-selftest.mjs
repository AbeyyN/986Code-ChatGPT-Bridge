import fs from 'node:fs';
import vm from 'node:vm';

const bg = fs.readFileSync('extension/background.js', 'utf8');
const opt = fs.readFileSync('extension/options.html', 'utf8');
const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));

const noopEvent = { addListener() {} };
const chrome = {
  storage: {
    local: { get: async () => ({ privacySchemaVersion: 1 }), set: async () => {}, remove: async () => {} },
    session: { get: async () => ({}), set: async () => {} }
  },
  tabs: { onActivated: noopEvent, onUpdated: noopEvent },
  runtime: { onInstalled: noopEvent, onStartup: noopEvent, onMessage: noopEvent, id: 'selftest' },
  permissions: { contains: async () => false, getAll: async () => ({}), onAdded: noopEvent, onRemoved: noopEvent }
};

const context = { chrome, console, URL, setTimeout, clearTimeout, crypto: globalThis.crypto };
vm.createContext(context);
vm.runInContext(`${bg}\nglobalThis.__security={hasInlineCredential,redactForAudit,sanitizeSshProfile};`, context);
const sec = context.__security;const credentialSample = { target:'ssh', action:'ssh.exec', password:'demo-only' };
if (!sec.hasInlineCredential(credentialSample)) throw new Error('Inline credential detector failed');

const redacted = sec.redactForAudit({
  command: { action:'type', selector:'#field', value:'sensitive-demo' },
  url: 'https://example.com/path?token=demo#fragment'
});
if (redacted.command.action !== 'type') throw new Error('Command metadata should be preserved');
if (redacted.command.value !== '[REDACTED]') throw new Error('Typed value was not redacted');
if (redacted.url !== 'https://example.com/path') throw new Error('URL query/hash was not removed');

const profile = sec.sanitizeSshProfile({ host:'server.test', port:22, username:'user', password:'demo', keyPath:'C:/key', authMethod:'keyfile' });
if ('password' in profile) throw new Error('SSH profile sanitizer retained a secret field');
if (profile.authMethod !== 'keyfile') throw new Error('SSH auth method sanitizer failed');if (/type=["']password["']/i.test(opt)) throw new Error('Password input must not exist in extension UI');
if (manifest.version_name !== '0.1.0-alpha.5') throw new Error('Unexpected manifest version');
if (!manifest.permissions.includes('debugger')) throw new Error('Debugger permission must be required for Chromium/Edge');
if ((manifest.optional_permissions || []).includes('debugger')) throw new Error('Debugger permission must not be optional');

const combined = bg + '\n' + opt;
for (const re of [
  /sk-[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /BEGIN (RSA |OPENSSH )?PRIVATE KEY/
]) {
  if (re.test(combined)) throw new Error(`Secret-like material detected: ${re}`);
}

console.log('SECURITY_SELFTEST_PASS');
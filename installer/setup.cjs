'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const zlib = require('node:zlib');
const sea = require('node:sea');

const VERSION = '0.1.0-alpha.5';
const HOST_NAME = 'com.abeyytechxy.986code_bridge';
const DEFAULT_EXTENSION_ID = process.env['986CODE_EXTENSION_ID'] || '';
const HOME = path.join(process.env.LOCALAPPDATA || os.homedir(), '986Code', 'Bridge');
const BIN = path.join(HOME, 'bin');
const MANIFEST = path.join(HOME, 'native-host.json');

function fail(message, code = 1) {
  console.error(`986Code Setup: ${message}`);
  process.exit(code);
}
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const k = a.slice(2); const n = argv[i + 1];
    if (n !== undefined && !n.startsWith('--')) { out[k] = n; i++; }
    else out[k] = true;
  }
  return out;
}function run(file, args, allowFail = false) {
  const r = spawnSync(file, args, { windowsHide: true, encoding: 'utf8' });
  if (!allowFail && (r.error || r.status !== 0)) {
    throw new Error(`${file} failed: ${r.error?.message || r.stderr || r.stdout || r.status}`);
  }
  return r;
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding:'utf8', mode:0o600 });
}
function extensionOrigin(id) {
  if (!/^[a-p]{32}$/.test(id)) fail('Extension ID must be 32 Chromium characters (a-p).');
  return `chrome-extension://${id}/`;
}
function extractAsset(key, dest) {
  if (!sea.isSea()) fail('Setup must run from the packaged SEA executable.');
  const raw = sea.getRawAsset(`${key}.gz`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, zlib.gunzipSync(Buffer.from(raw)));
}
function registryKeys() {
  return [
    `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
    `HKCU\\Software\\Opera Software\\NativeMessagingHosts\\${HOST_NAME}`,
    `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`
  ];
}function hardenAcl() {
  const who = `${process.env.USERDOMAIN || ''}\\${process.env.USERNAME || ''}`.replace(/^\\/,'');
  if (!who) return;
  run('icacls.exe', [HOME, '/inheritance:r', '/grant:r', `${who}:(OI)(CI)F`, 'SYSTEM:(OI)(CI)F'], true);
}
function addCliPath() {
  const q = run('reg.exe', ['query','HKCU\\Environment','/v','Path'], true);
  let current = '';
  if (q.status === 0) {
    const line = String(q.stdout || '').split(/\r?\n/).find((x) => /\sPath\s+REG_/.test(x));
    if (line) current = line.replace(/^.*?REG_(?:EXPAND_)?SZ\s+/,'').trim();
  }
  const parts = current.split(';').map((x) => x.trim()).filter(Boolean);
  if (!parts.some((x) => x.toLowerCase() === BIN.toLowerCase())) parts.push(BIN);
  run('reg.exe', ['add','HKCU\\Environment','/v','Path','/t','REG_EXPAND_SZ','/d',parts.join(';'),'/f']);
}
function removeCliPath() {
  const q = run('reg.exe', ['query','HKCU\\Environment','/v','Path'], true);
  if (q.status !== 0) return;
  const line = String(q.stdout || '').split(/\r?\n/).find((x) => /\sPath\s+REG_/.test(x));
  if (!line) return;
  const current = line.replace(/^.*?REG_(?:EXPAND_)?SZ\s+/,'').trim();
  const parts = current.split(';').map((x) => x.trim()).filter((x) => x && x.toLowerCase() !== BIN.toLowerCase());
  run('reg.exe', ['add','HKCU\\Environment','/v','Path','/t','REG_EXPAND_SZ','/d',parts.join(';'),'/f'], true);
}function install(args) {
  const extId = String(args['extension-id'] || DEFAULT_EXTENSION_ID).trim();
  if (!extId) fail('Missing --extension-id. Copy the 986Code extension ID from your browser extension manager.');
  fs.mkdirSync(BIN, { recursive: true });
  fs.mkdirSync(path.join(HOME, 'instances'), { recursive: true });
  extractAsset('986code-native-host.exe', path.join(BIN, '986code-native-host.exe'));
  extractAsset('986code.exe', path.join(BIN, '986code.exe'));
  extractAsset('986code-mcp.exe', path.join(BIN, '986code-mcp.exe'));
  writeJson(MANIFEST, {
    name: HOST_NAME,
    description: '986Code Bridge Native Control Plane',
    path: path.join(BIN, '986code-native-host.exe'),
    type: 'stdio',
    allowed_origins: [extensionOrigin(extId)]
  });
  for (const key of registryKeys()) {
    run('reg.exe', ['add', key, '/ve', '/t', 'REG_SZ', '/d', MANIFEST, '/f']);
  }
  if (args['add-cli-path'] !== false && args['no-cli-path'] !== true) addCliPath();
  hardenAcl();
  writeJson(path.join(HOME, 'install.json'), {
    version: VERSION, installedAt: new Date().toISOString(), extensionId: extId,
    hostExe: path.join(BIN, '986code-native-host.exe'), cliExe: path.join(BIN, '986code.exe'),
    mcpExe: path.join(BIN, '986code-mcp.exe'), manifest: MANIFEST
  });
  console.log(`986Code Bridge ${VERSION} installed.`);
  console.log(`ROOT=${HOME}`);
  console.log(`EXTENSION_ID=${extId}`);
  console.log(`CLI=${path.join(BIN, '986code.exe')}`);
  console.log(`MCP=${path.join(BIN, '986code-mcp.exe')}`);
  console.log('Reload the extension, then enable Native Messaging in Options.');
}function uninstall(args) {
  for (const key of registryKeys()) run('reg.exe', ['delete', key, '/f'], true);
  removeCliPath();
  const profileFile = path.join(HOME, 'profiles.json');
  let savedProfile = null;
  if (args['keep-profiles'] && fs.existsSync(profileFile)) {
    savedProfile = path.join(os.homedir(), `986Code-profiles-${Date.now()}.json`);
    fs.copyFileSync(profileFile, savedProfile);
  }
  fs.rmSync(HOME, { recursive:true, force:true });
  console.log(`986Code Bridge ${VERSION} uninstalled.`);
  if (savedProfile) console.log(`PROFILE_BACKUP=${savedProfile}`);
}
function usage() {
  console.log(`986Code Bridge Setup ${VERSION}\n\nUsage:\n  setup.exe --extension-id <id> [--no-cli-path]\n  setup.exe --uninstall [--keep-profiles]`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._[0] === 'help') usage();
  else if (args.uninstall) uninstall(args);
  else install(args);
} catch (error) {
  fail(error.stack || String(error));
}
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const VERSION = '0.1.0-alpha.6-dev';
const HOME = process.env['986CODE_HOME'] || path.join(process.env.LOCALAPPDATA || os.homedir(), '986Code', 'Bridge');
const INSTANCE_DIR = path.join(HOME, 'instances');
const PROFILE_FILE = path.join(HOME, 'profiles.json');

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { out._.push(arg); continue; }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

function sanitizeProfile(profile = {}) {
  const authMethod = ['agent', 'keyfile'].includes(profile.authMethod) ? profile.authMethod : 'agent';
  return {
    host: String(profile.host || '').trim(),
    port: Math.max(1, Math.min(65535, Number(profile.port || 22))),
    username: String(profile.username || '').trim(),
    authMethod,
    keyPath: authMethod === 'keyfile' ? String(profile.keyPath || '').trim() : ''
  };
}

function loadInstances() {
  if (!fs.existsSync(INSTANCE_DIR)) return [];
  const out = [];
  for (const name of fs.readdirSync(INSTANCE_DIR)) {
    if (!name.endsWith('.json')) continue;
    const item = readJson(path.join(INSTANCE_DIR, name), null);
    if (item?.instanceId && item?.port && item?.token) out.push(item);
  }
  return out.sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

function publicInstance(item) {
  return {
    instanceId: item.instanceId,
    label: item.label,
    host: item.host,
    port: item.port,
    permissions: item.permissions,
    extensionVersion: item.extensionVersion,
    nativeVersion: item.version,
    pid: item.pid,
    updatedAt: item.updatedAt
  };
}

function resolveInstance(selector) {
  const items = loadInstances();
  if (!selector) {
    if (items.length === 1) return items[0];
    fail('Multiple/no browser instances available. Use --instance <label-or-id>.');
  }
  const exact = items.filter((i) => i.instanceId === selector || i.label === selector);
  if (exact.length === 1) return exact[0];
  const prefix = items.filter((i) => String(i.instanceId).startsWith(selector));
  if (prefix.length === 1) return prefix[0];
  fail(`Instance not uniquely found: ${selector}`);
}

async function api(instance, method, route, body) {
  const headers = { authorization: `Bearer ${instance.token}`, 'content-type': 'application/json' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`http://127.0.0.1:${instance.port}${route}`, {
      method, headers, signal: controller.signal,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch (_) { json = { ok: false, raw: text }; }
    return { status: res.status, body: json };
  } finally { clearTimeout(timer); }
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function commandList() {
  const results = [];
  for (const item of loadInstances()) {
    let healthy = false;
    try {
      const r = await api(item, 'GET', '/v1/info');
      healthy = r.status === 200 && r.body?.ok === true;
    } catch (_) {}
    results.push({ ...publicInstance(item), healthy });
  }
  print(results);
}

async function commandDoctor() {
  const items = loadInstances();
  const report = { ok: true, version: VERSION, home: HOME, instances: [], profiles: Object.keys(readJson(PROFILE_FILE, {})) };
  for (const item of items) {
    try {
      const r = await api(item, 'GET', '/v1/info');
      report.instances.push({ ...publicInstance(item), healthy: r.status === 200 && r.body?.ok === true });
      if (r.status !== 200) report.ok = false;
    } catch (error) {
      report.ok = false;
      report.instances.push({ ...publicInstance(item), healthy: false, error: String(error?.message || error) });
    }
  }
  if (!items.length) report.ok = false;
  print(report);
  if (!report.ok) process.exitCode = 2;
}

async function commandExec(args) {
  const instance = resolveInstance(args.instance);
  if (!args.json) fail('exec requires --json <command-json>.');
  let command;
  try { command = JSON.parse(args.json); }
  catch (error) { fail(`Invalid --json: ${error.message}`); }
  const result = await api(instance, 'POST', '/v1/command', { command });
  print(result.body);
  if (result.status >= 400 || result.body?.ok === false) process.exitCode = 3;
}

async function commandSsh(args) {
  const instance = resolveInstance(args.instance);
  if (!args.profile || !args.command) fail('ssh requires --profile <name> --command <remote-command>.');
  const command = {
    target: 'ssh', action: 'ssh.exec', profile: args.profile,
    command: args.command, timeoutMs: Number(args.timeout || 30000)
  };
  const result = await api(instance, 'POST', '/v1/command', { command });
  print(result.body);
  if (result.status >= 400 || result.body?.ok === false) process.exitCode = 3;
}

function profileList() {
  print(readJson(PROFILE_FILE, {}));
}

function profileSet(args) {
  const name = String(args.name || '').trim();
  if (!name || !args.host || !args.user) fail('profile set requires --name --host --user.');
  const profiles = readJson(PROFILE_FILE, {});
  profiles[name] = sanitizeProfile({
    host: args.host,
    port: Number(args.port || 22),
    username: args.user,
    authMethod: args.auth || (args.key ? 'keyfile' : 'agent'),
    keyPath: args.key || ''
  });
  writeJsonAtomic(PROFILE_FILE, profiles);
  print({ ok: true, name, profile: profiles[name] });
}

function profileDelete(args) {
  const name = String(args.name || '').trim();
  if (!name) fail('profile delete requires --name <profile>.');
  const profiles = readJson(PROFILE_FILE, {});
  const existed = Object.prototype.hasOwnProperty.call(profiles, name);
  delete profiles[name];
  writeJsonAtomic(PROFILE_FILE, profiles);
  print({ ok: true, name, existed });
}

function usage() {
  console.log(`986Code CLI ${VERSION}\n\nCommands:\n  list\n  doctor\n  exec --instance <label|id> --json <json>\n  ssh --instance <label|id> --profile <name> --command <cmd> [--timeout 30000]\n  profile list\n  profile set --name <name> --host <host> --user <user> [--port 22] [--auth agent|keyfile] [--key <path>]\n  profile delete --name <name>`);
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, sub] = args._;
  if (!cmd || cmd === 'help' || args.help) return usage();
  if (cmd === 'list') return commandList();
  if (cmd === 'doctor') return commandDoctor();
  if (cmd === 'exec') return commandExec(args);
  if (cmd === 'ssh') return commandSsh(args);
  if (cmd === 'profile' && sub === 'list') return profileList();
  if (cmd === 'profile' && sub === 'set') return profileSet(args);
  if (cmd === 'profile' && sub === 'delete') return profileDelete(args);
  fail(`Unknown command: ${args._.join(' ')}`);
})().catch((error) => fail(error.stack || String(error)));

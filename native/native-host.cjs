'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const VERSION = '0.1.0-alpha.4';
const HOST_NAME = 'com.abeyytechxy.986code_bridge';
const HOME = process.env['986CODE_HOME'] || path.join(process.env.LOCALAPPDATA || os.homedir(), '986Code', 'Bridge');
const INSTANCE_DIR = path.join(HOME, 'instances');
const PROFILE_FILE = path.join(HOME, 'profiles.json');

fs.mkdirSync(INSTANCE_DIR, { recursive: true });

let inputBuffer = Buffer.alloc(0);
let instance = null;
let httpServer = null;
let localToken = null;
let shuttingDown = false;
const pendingHttp = new Map();

function writeNative(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

function loadProfiles() {
  try { return JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8')); }
  catch (_) { return {}; }
}

function saveProfiles(profiles) {
  atomicJson(PROFILE_FILE, profiles);
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

function instanceFile() {
  return instance ? path.join(INSTANCE_DIR, `${instance.instanceId}.json`) : null;
}

function registerInstance(extra = {}) {
  if (!instance || !httpServer || !localToken) return;
  const address = httpServer.address();
  if (!address || typeof address === 'string') return;
  atomicJson(instanceFile(), {
    product: '986Code Bridge',
    version: VERSION,
    hostName: HOST_NAME,
    instanceId: instance.instanceId,
    label: instance.label,
    extensionVersion: instance.extensionVersion || null,
    permissions: instance.permissions,
    pid: process.pid,
    host: '127.0.0.1',
    port: address.port,
    token: localToken,
    startedAt: instance.startedAt,
    updatedAt: new Date().toISOString(),
    ...extra
  });
}

function removeInstance() {
  const file = instanceFile();
  if (!file) return;
  try { fs.unlinkSync(file); } catch (_) {}
}

function isLoopback(address = '') {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': data.length,
    'cache-control': 'no-store'
  });
  res.end(data);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (error) { reject(new Error(`Invalid JSON: ${error.message}`)); }
    });
    req.on('error', reject);
  });
}

function authorized(req) {
  const value = String(req.headers.authorization || '');
  if (!value.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(value.slice(7));
  const expected = Buffer.from(localToken || '');
  return supplied.length === expected.length && supplied.length > 0 && crypto.timingSafeEqual(supplied, expected);
}

function commandId() {
  return `986-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function requiredTier(command = {}) {
  const target = String(command.target || 'page').toLowerCase();
  const action = String(command.action || '').toLowerCase();
  if (['ssh', 'native', 'terminal', 'cdp', 'power'].includes(target) || action.startsWith('ssh.') || action.startsWith('cdp.')) return 'power';
  if (['browser', 'tab'].includes(target)) {
    return ['tab.list', 'tabs', 'capture', 'screenshot'].includes(action) ? 'read' : 'write';
  }
  return ['read', 'inspect', 'ping', 'wait', 'value'].includes(action) ? 'read' : 'write';
}

function enforceTier(command = {}) {
  const tier = requiredTier(command);
  if (instance?.permissions?.[tier] !== true) throw new Error(`${tier.toUpperCase()} tier is disabled for this browser instance.`);
  return tier;
}

function waitForExtension(command, timeoutMs = 30000) {
  const requestId = commandId();
  const timeout = Math.max(1000, Math.min(120000, Number(timeoutMs || 30000)));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingHttp.delete(requestId);
      reject(new Error('Extension command timeout'));
    }, timeout);
    pendingHttp.set(requestId, { resolve, reject, timer });
    writeNative({ type: 'execute', requestId, command });
  });
}

function runProcess(file, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const cap = 1024 * 1024;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch (_) {}
    }, timeoutMs);
    child.stdout.on('data', (d) => { if (stdout.length < cap) stdout += d.toString(); });
    child.stderr.on('data', (d) => { if (stderr.length < cap) stderr += d.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ ok: false, error: error.message, stdout, stderr });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish({
        ok: code === 0 && !timedOut,
        code,
        timedOut,
        stdout: stdout.slice(0, cap),
        stderr: stderr.slice(0, cap)
      });
    });
  });
}

async function executeSsh(command = {}) {
  enforceTier({ ...command, target: 'ssh' });
  const profiles = loadProfiles();
  const profile = profiles[String(command.profile || '')];
  if (!profile) throw new Error(`Native SSH profile not found: ${command.profile || '(missing)'}`);
  const p = sanitizeProfile(profile);
  if (!p.host || !p.username) throw new Error('SSH profile requires host and username.');
  const remoteCommand = String(command.command || '').trim();
  if (!remoteCommand) throw new Error('ssh.exec requires command.');
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-p', String(p.port)];
  if (p.authMethod === 'keyfile') {
    if (!p.keyPath) throw new Error('Key-file profile requires keyPath.');
    args.push('-i', p.keyPath);
  }
  args.push(`${p.username}@${p.host}`, '--', remoteCommand);
  const timeoutMs = Math.max(1000, Math.min(120000, Number(command.timeoutMs || 30000)));
  return { ...(await runProcess('ssh.exe', args, timeoutMs)), profile: String(command.profile) };
}

async function handleHttp(req, res) {
  if (!isLoopback(req.socket.remoteAddress || '')) return sendJson(res, 403, { ok: false, error: 'Loopback only' });
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, product: '986Code Bridge', version: VERSION });
  }
  if (!authorized(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
  if (req.method === 'GET' && url.pathname === '/v1/info') {
    return sendJson(res, 200, {
      ok: true,
      instanceId: instance?.instanceId,
      label: instance?.label,
      permissions: instance?.permissions,
      extensionVersion: instance?.extensionVersion,
      nativeVersion: VERSION,
      pid: process.pid
    });
  }
  if (req.method === 'POST' && url.pathname === '/v1/command') {
    try {
      const body = await readBody(req);
      const command = body.command || body;
      const tier = enforceTier(command);
      const target = String(command.target || 'page').toLowerCase();
      const result = target === 'ssh'
        ? await executeSsh(command)
        : await waitForExtension(command, command.timeoutMs);
      return sendJson(res, result?.ok === false ? 422 : 200, { ...result, tier });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: String(error?.message || error) });
    }
  }
  return sendJson(res, 404, { ok: false, error: 'Not found' });
}

async function startHttp() {
  if (httpServer) return;
  localToken = crypto.randomBytes(32).toString('base64url');
  httpServer = http.createServer((req, res) => {
    handleHttp(req, res).catch((error) => sendJson(res, 500, { ok: false, error: error.message }));
  });
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  registerInstance({ status: 'connected' });
}

async function handleNativeRequest(message) {
  const action = String(message.action || '').toLowerCase();
  if (action === 'profile.list') return { ok: true, profiles: loadProfiles() };
  if (action === 'profile.save') {
    const name = String(message.name || '').trim();
    if (!name) throw new Error('Profile name is required.');
    const profiles = loadProfiles();
    profiles[name] = sanitizeProfile(message.profile || {});
    saveProfiles(profiles);
    return { ok: true, name, profile: profiles[name] };
  }
  if (action === 'profile.delete') {
    const name = String(message.name || '').trim();
    const profiles = loadProfiles();
    delete profiles[name];
    saveProfiles(profiles);
    return { ok: true, name };
  }
  if (action === 'ssh.exec') return executeSsh(message.command || {});
  if (action === 'native.info') {
    const address = httpServer?.address();
    return {
      ok: true,
      version: VERSION,
      hostName: HOST_NAME,
      instanceId: instance?.instanceId,
      label: instance?.label,
      permissions: instance?.permissions,
      controlPlane: address && typeof address !== 'string' ? { host: '127.0.0.1', port: address.port } : null
    };
  }
  throw new Error(`Unsupported native request: ${action}`);
}

async function handleNative(message = {}) {
  if (message.type === 'hello') {
    instance = {
      instanceId: String(message.instanceId || '').trim(),
      label: String(message.label || '').trim() || '986Code Browser',
      extensionVersion: String(message.extensionVersion || ''),
      permissions: {
        read: message.permissions?.read !== false,
        write: message.permissions?.write !== false,
        power: message.permissions?.power === true
      },
      startedAt: new Date().toISOString()
    };
    if (!instance.instanceId) throw new Error('instanceId is required.');
    await startHttp();
    registerInstance({ status: 'connected' });
    const address = httpServer.address();
    writeNative({
      type: 'hello.ack',
      ok: true,
      nativeVersion: VERSION,
      instanceId: instance.instanceId,
      label: instance.label,
      controlPlane: { host: '127.0.0.1', port: address.port }
    });
    return;
  }
  if (message.type === 'policy.update') {
    if (!instance) throw new Error('hello must be sent first.');
    if (typeof message.label === 'string' && message.label.trim()) instance.label = message.label.trim();
    if (message.permissions) {
      instance.permissions = {
        read: message.permissions.read !== false,
        write: message.permissions.write !== false,
        power: message.permissions.power === true
      };
    }
    registerInstance({ status: 'connected' });
    writeNative({
      type: 'policy.ack',
      ok: true,
      requestId: message.requestId || null,
      label: instance.label,
      permissions: instance.permissions
    });
    return;
  }
  if (message.type === 'result') {
    const pending = pendingHttp.get(String(message.requestId || ''));
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingHttp.delete(String(message.requestId));
    pending.resolve(message.result || { ok: false, error: 'Empty extension result' });
    return;
  }
  if (message.type === 'native.request') {
    const requestId = String(message.requestId || commandId());
    try {
      const result = await handleNativeRequest(message);
      writeNative({ type: 'native.response', requestId, result });
    } catch (error) {
      writeNative({
        type: 'native.response',
        requestId,
        result: { ok: false, error: String(error?.message || error) }
      });
    }
    return;
  }
  if (message.type === 'ping') writeNative({ type: 'pong', at: new Date().toISOString(), version: VERSION });
}

function consumeNativeInput(chunk) {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  while (inputBuffer.length >= 4) {
    const size = inputBuffer.readUInt32LE(0);
    if (size > 8 * 1024 * 1024) throw new Error('Native message too large');
    if (inputBuffer.length < 4 + size) return;
    const payload = inputBuffer.subarray(4, 4 + size);
    inputBuffer = inputBuffer.subarray(4 + size);
    const message = JSON.parse(payload.toString('utf8'));
    Promise.resolve(handleNative(message)).catch((error) => {
      writeNative({ type: 'error', ok: false, error: String(error?.message || error) });
    });
  }
}

function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  removeInstance();
  try { httpServer?.close(); } catch (_) {}
  for (const pending of pendingHttp.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error('Native host shutting down'));
  }
  pendingHttp.clear();
}

process.stdin.on('data', (chunk) => {
  try { consumeNativeInput(chunk); }
  catch (error) {
    writeNative({ type: 'error', ok: false, error: String(error?.message || error) });
    cleanup();
    process.exitCode = 1;
  }
});
process.stdin.on('end', () => { cleanup(); process.exit(0); });
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('exit', removeInstance);

process.stderr.write(`986Code Native Host ${VERSION} ready\n`);

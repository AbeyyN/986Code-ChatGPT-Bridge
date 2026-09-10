'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

const HOME = process.env['986CODE_HOME'] || path.join(process.env.LOCALAPPDATA || os.homedir(), '986Code', 'Bridge');
const INSTANCE_DIR = path.join(HOME, 'instances');
const PROFILE_FILE = path.join(HOME, 'profiles.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function instances() {
  try {
    return fs.readdirSync(INSTANCE_DIR).filter((n) => n.endsWith('.json')).map((n) => readJson(path.join(INSTANCE_DIR, n), null)).filter(Boolean);
  } catch (_) { return []; }
}

function pickInstance(ref) {
  const all = instances();
  if (!ref && all.length === 1) return all[0];
  const key = String(ref || '').toLowerCase();
  const exact = all.find((x) => String(x.instanceId).toLowerCase() === key || String(x.label).toLowerCase() === key);
  if (exact) return exact;
  const partial = all.filter((x) => String(x.instanceId).toLowerCase().startsWith(key) || String(x.label).toLowerCase().includes(key));
  if (partial.length === 1) return partial[0];
  throw new Error(ref ? `Instance not uniquely found: ${ref}` : `Specify --instance; active instances=${all.length}`);
}
function request(instance, method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request({
      host:'127.0.0.1', port:instance.port, path:route, method,
      headers:{ authorization:`Bearer ${instance.token}`, ...(payload ? {'content-type':'application/json','content-length':payload.length} : {}) }
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed; try { parsed = JSON.parse(text || '{}'); } catch (_) { parsed = { ok:false, error:text }; }
        if (res.statusCode >= 400) reject(new Error(parsed.error || `HTTP ${res.statusCode}`)); else resolve(parsed);
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback;
}

function saveProfiles(value) {
  fs.mkdirSync(HOME, { recursive:true });
  fs.writeFileSync(PROFILE_FILE, `${JSON.stringify(value, null, 2)}\n`, { encoding:'utf8', mode:0o600 });
}

function sanitizeProfile(p = {}) {
  const authMethod = ['agent','keyfile'].includes(p.authMethod) ? p.authMethod : 'agent';
  return { host:String(p.host || '').trim(), port:Number(p.port || 22), username:String(p.username || '').trim(), authMethod, keyPath:authMethod === 'keyfile' ? String(p.keyPath || '').trim() : '' };
}
async function main() {
  const command = String(process.argv[2] || 'help').toLowerCase();
  if (command === 'list') {
    const rows = instances().map(({token, ...x}) => x);
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (command === 'doctor') {
    const all = instances();
    const results = [];
    for (const item of all) {
      try { results.push(await request(item, 'GET', '/v1/info')); }
      catch (error) { results.push({ ok:false, instanceId:item.instanceId, label:item.label, error:error.message }); }
    }
    console.log(JSON.stringify({ ok:results.every((r) => r.ok), instances:results }, null, 2));
    return;
  }
  if (command === 'exec') {
    const item = pickInstance(arg('--instance'));
    const raw = arg('--json');
    if (!raw) throw new Error('exec requires --json <command-json>');
    const result = await request(item, 'POST', '/v1/command', { command:JSON.parse(raw) });
    console.log(JSON.stringify(result, null, 2));
    if (result.ok === false) process.exitCode = 2;
    return;
  }
  if (command === 'ssh') {
    const item = pickInstance(arg('--instance'));
    const profile = arg('--profile');
    const remoteCommand = arg('--command');
    if (!profile || !remoteCommand) throw new Error('ssh requires --profile and --command');
    const result = await request(item, 'POST', '/v1/command', { command:{ target:'ssh', action:'ssh.exec', profile, command:remoteCommand } });
    console.log(JSON.stringify(result, null, 2));
    if (result.ok === false) process.exitCode = 2;
    return;
  }
  if (command === 'profile') {
    const sub = String(process.argv[3] || 'list').toLowerCase();
    const profiles = readJson(PROFILE_FILE, {});
    if (sub === 'list') { console.log(JSON.stringify(profiles, null, 2)); return; }
    if (sub === 'delete') {
      const name = arg('--name'); if (!name) throw new Error('profile delete requires --name');
      delete profiles[name]; saveProfiles(profiles); console.log(JSON.stringify({ok:true,name}, null, 2)); return;
    }
    if (sub === 'set') {
      const name = arg('--name'); const host = arg('--host'); const username = arg('--user');
      if (!name || !host || !username) throw new Error('profile set requires --name --host --user');
      profiles[name] = sanitizeProfile({ host, username, port:Number(arg('--port','22')), authMethod:arg('--auth','agent'), keyPath:arg('--key','') });
      saveProfiles(profiles); console.log(JSON.stringify({ok:true,name,profile:profiles[name]}, null, 2)); return;
    }
    throw new Error(`Unknown profile subcommand: ${sub}`);
  }
  console.log(`986Code CLI\n\nCommands:\n  list\n  doctor\n  exec --instance <label|id> --json <command-json>\n  ssh --instance <label|id> --profile <name> --command <remote-command>\n  profile list\n  profile set --name <name> --host <host> --user <user> [--port 22] [--auth agent|keyfile] [--key path]\n  profile delete --name <name>`);
}

main().catch((error) => { console.error(`986Code CLI error: ${error.message}`); process.exitCode = 1; });

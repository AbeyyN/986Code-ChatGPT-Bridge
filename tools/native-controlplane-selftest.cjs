'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const repo = path.resolve(__dirname, '..');
const hostSource = path.join(repo, 'native', 'native-host.cjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), '986code-selftest-'));

function frame(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

function startHost(instanceId, label) {
  const child = spawn(process.execPath, [hostSource], {
    env: { ...process.env, '986CODE_HOME': home },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
  });
  let buffer = Buffer.alloc(0);
  const messages = [];
  const waiters = [];
  function deliver(message) {
    messages.push(message);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].predicate(message)) {
        const w = waiters.splice(i, 1)[0];
        clearTimeout(w.timer); w.resolve(message);
      }
    }
  }

  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const size = buffer.readUInt32LE(0);
      if (buffer.length < 4 + size) break;
      const body = buffer.subarray(4, 4 + size);
      buffer = buffer.subarray(4 + size);
      deliver(JSON.parse(body.toString('utf8')));
    }
  });

  function waitFor(predicate, timeoutMs = 5000) {
    const hit = messages.find(predicate);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), timeoutMs);
      waiters.push({ predicate, resolve, reject, timer });
    });
  }
  child.stdin.write(frame({
    type: 'hello', instanceId, label,
    extensionVersion: 'selftest',
    permissions: { read: true, write: true, power: false }
  }));

  return {
    child, instanceId, label, waitFor,
    send(message) { child.stdin.write(frame(message)); },
    async ready() {
      const ack = await waitFor((m) => m.type === 'hello.ack');
      assert.equal(ack.ok, true);
      assert.equal(ack.instanceId, instanceId);
      return ack;
    },
    stop() {
      try { child.stdin.end(); } catch (_) {}
      setTimeout(() => { try { child.kill(); } catch (_) {} }, 250);
    }
  };
}

async function loadInstance(id) {
  const file = path.join(home, 'instances', `${id}.json`);
  for (let i = 0; i < 50; i++) {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`instance file missing: ${id}`);
}
async function api(instance, method, route, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${instance.port}${route}`, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json;
  try { json = await res.json(); } catch (_) { json = null; }
  return { status: res.status, json };
}

async function exerciseBrowserBridge(host, instance) {
  const expected = { ok: true, echo: host.label };
  const pending = api(instance, 'POST', '/v1/command', {
    command: { target: 'browser', action: 'tab.list', marker: host.label }
  }, instance.token);
  const exec = await host.waitFor((m) => m.type === 'execute' && m.command?.marker === host.label);
  host.send({ type: 'result', requestId: exec.requestId, result: expected });
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal(response.json.ok, true);
  assert.equal(response.json.echo, host.label);
  assert.equal(response.json.tier, 'read');
}

(async () => {
  const a = startHost('instance-A-986', 'PERSONAL-OPERA');
  const b = startHost('instance-B-986', 'WORK-OPERA');
  try {
    await Promise.all([a.ready(), b.ready()]);
    const [ia, ib] = await Promise.all([loadInstance(a.instanceId), loadInstance(b.instanceId)]);
    assert.notEqual(ia.port, ib.port);
    assert.notEqual(ia.token, ib.token);
    assert.equal(ia.label, 'PERSONAL-OPERA');
    assert.equal(ib.label, 'WORK-OPERA');

    const health = await api(ia, 'GET', '/health');
    assert.equal(health.status, 200);
    const denied = await api(ia, 'GET', '/v1/info');
    assert.equal(denied.status, 401);
    const info = await api(ia, 'GET', '/v1/info', undefined, ia.token);
    assert.equal(info.status, 200);
    assert.equal(info.json.instanceId, a.instanceId);

    await Promise.all([
      exerciseBrowserBridge(a, ia),
      exerciseBrowserBridge(b, ib)
    ]);

    console.log('NATIVE_CONTROLPLANE_SELFTEST_PASS');
    console.log(JSON.stringify({
      a: { label: ia.label, port: ia.port },
      b: { label: ib.label, port: ib.port },
      isolation: true, loopbackOnly: true, bearerAuth: true
    }));
  } finally {
    a.stop(); b.stop();
    setTimeout(() => fs.rmSync(home, { recursive: true, force: true }), 300);
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

import path from 'node:path';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const command = process.env['986CODE_MCP_EXE'] || path.resolve('dist/native/986code-mcp.exe');
const client = new Client({ name: '986code-live-e2e', version: '0.1.0-alpha.5' });
const transport = new StdioClientTransport({ command, cwd: process.cwd(), env: { ...process.env }, stderr: 'pipe' });
const textJson = (result) => JSON.parse(result.content.find((x) => x.type === 'text')?.text || '{}');
try {
  await client.connect(transport);
  const listed = textJson(await client.callTool({ name: 'browser.instances.list', arguments: {} }));
  const personal = listed.find((x) => x.label === 'PERSONAL-OPERA');
  const work = listed.find((x) => x.label === 'WORK-OPERA');
  assert.ok(personal && work, 'PERSONAL-OPERA and WORK-OPERA must both be connected');
  const p = textJson(await client.callTool({ name: 'browser.tabs.list', arguments: { instance: personal.label } }));
  const w = textJson(await client.callTool({ name: 'browser.tabs.list', arguments: { instance: work.label } }));
  assert.ok(p.tabs.some((t) => String(t.url).includes('profile=PERSONAL')));
  assert.ok(w.tabs.some((t) => String(t.url).includes('profile=WORK')));
  assert.ok(!p.tabs.some((t) => String(t.url).includes('profile=WORK')));
  assert.ok(!w.tabs.some((t) => String(t.url).includes('profile=PERSONAL')));
  console.log('MCP_LIVE_E2E_PASS');
  console.log(JSON.stringify({ personal: personal.instanceId, work: work.instanceId, crossProfileIsolation: true }));
} finally {
  await client.close().catch(() => {});
}

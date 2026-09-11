import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const serverPath = path.join(repo, 'mcp', 'server.mjs');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: repo,
  env: { ...process.env },
  stderr: 'pipe'
});
const client = new Client({ name: '986code-selftest', version: '0.1.0-alpha.5' });
try {
  await client.connect(transport);
  assert.deepEqual(await client.ping(), {});
  const listed = await client.listTools();
  const names = listed.tools.map((t) => t.name).sort();
  for (const name of ['browser.instances.list','browser.tabs.list','browser.read','browser.click','browser.type','ssh.exec']) {
    assert.ok(names.includes(name), `missing MCP tool: ${name}`);
  }
  const instanceResult = await client.callTool({ name: 'browser.instances.list', arguments: {} });
  assert.equal(instanceResult.isError, undefined);
  const text = instanceResult.content.find((item) => item.type === 'text')?.text || '[]';
  const instances = JSON.parse(text);
  assert.ok(Array.isArray(instances));
  console.log('MCP_SELFTEST_PASS');
  console.log(JSON.stringify({ toolCount: names.length, connectedInstances: instances.map((i) => i.label) }));
} finally {
  await client.close().catch(() => {});
}

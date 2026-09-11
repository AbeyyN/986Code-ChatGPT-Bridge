import path from 'node:path';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const exe = path.resolve('dist/native/986code-mcp.exe');
const transport = new StdioClientTransport({ command: exe, cwd: process.cwd(), env: { ...process.env }, stderr: 'pipe' });
const client = new Client({ name: '986code-binary-selftest', version: '0.1.0-alpha.5' });
try {
  await client.connect(transport);
  await client.ping();
  const tools = await client.listTools();
  assert.ok(tools.tools.some((t) => t.name === 'browser.instances.list'));
  const out = await client.callTool({ name: 'browser.instances.list', arguments: {} });
  const text = out.content.find((x) => x.type === 'text')?.text || '[]';
  const instances = JSON.parse(text);
  assert.ok(Array.isArray(instances));
  console.log('MCP_BINARY_SELFTEST_PASS');
  console.log(JSON.stringify({ toolCount: tools.tools.length, instances: instances.map((i) => i.label) }));
} finally {
  await client.close().catch(() => {});
}

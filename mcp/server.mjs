import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const VERSION = '0.1.0-alpha.5';
const HOME = process.env['986CODE_HOME'] || path.join(process.env.LOCALAPPDATA || os.homedir(), '986Code', 'Bridge');
const INSTANCE_DIR = path.join(HOME, 'instances');

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function loadInstances() {
  if (!fs.existsSync(INSTANCE_DIR)) return [];
  return fs.readdirSync(INSTANCE_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson(path.join(INSTANCE_DIR, name)))
    .filter((item) => item?.instanceId && item?.port && item?.token);
}

function publicInstance(item) {
  return {
    instanceId: item.instanceId, label: item.label, host: item.host,
    port: item.port, permissions: item.permissions,
    extensionVersion: item.extensionVersion, nativeVersion: item.version,
    pid: item.pid, updatedAt: item.updatedAt
  };
}

function resolveInstance(selector) {
  const items = loadInstances();
  if (!selector) throw new Error('instance is required to prevent cross-profile targeting.');
  const exact = items.filter((item) => item.instanceId === selector || item.label === selector);
  if (exact.length === 1) return exact[0];
  const prefix = items.filter((item) => String(item.instanceId).startsWith(selector));
  if (prefix.length === 1) return prefix[0];
  if (!items.length) throw new Error('No connected 986Code browser instances.');
  throw new Error(`Instance not uniquely found: ${selector}`);
}

async function bridgeCall(selector, command) {
  const instance = resolveInstance(selector);
  const controller = new AbortController();
  const timeout = Math.max(1000, Math.min(120000, Number(command.timeoutMs || 30000)));
  const timer = setTimeout(() => controller.abort(), timeout + 1000);
  try {
    const res = await fetch(`http://127.0.0.1:${instance.port}/v1/command`, {
      method: 'POST', signal: controller.signal,
      headers: { authorization: `Bearer ${instance.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ command })
    });
    const body = await res.json();
    if (!res.ok || body?.ok === false) throw new Error(body?.error || `986Code HTTP ${res.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function resultText(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: String(error?.message || error) }]
  };
}

function withErrorBoundary(handler) {
  return async (args) => {
    try { return await handler(args); }
    catch (error) { return errorResult(error); }
  };
}

function locatorFrom(args) {
  const out = {};
  for (const key of ['tabId','selector','text','label','role','name','placeholder']) {
    if (args[key] !== undefined && args[key] !== null && args[key] !== '') out[key] = args[key];
  }
  return out;
}

const instanceField = z.string().min(1).describe('986Code browser instance label or instance ID.');
const tabField = z.number().int().positive().optional().describe('Explicit Chromium tab ID.');
const locatorShape = {
  instance: instanceField,
  tabId: tabField,
  selector: z.string().optional(),
  text: z.string().optional(),
  label: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  placeholder: z.string().optional()
};

function buildServer() {
  const server = new McpServer(
    { name: '986code-bridge', version: VERSION },
    {
      instructions: 'Use browser.instances.list first. Always pass the intended instance label or ID to prevent cross-profile control. READ/WRITE/POWER tiers are enforced by the bridge.'
    }
  );

  server.registerTool('browser.instances.list', {
    title: 'List 986Code browser instances',
    description: 'List connected browser profiles without exposing local bearer tokens.',
    inputSchema: z.object({})
  }, async () => resultText(loadInstances().map(publicInstance)));

  server.registerTool('browser.tabs.list', {
    title: 'List tabs',
    description: 'List tabs inside one explicit 986Code browser instance.',
    inputSchema: z.object({ instance: instanceField }),
    annotations: { readOnlyHint: true }
  }, withErrorBoundary(async ({ instance }) =>
    resultText(await bridgeCall(instance, { target: 'browser', action: 'tab.list' }))));

  server.registerTool('browser.inspect', {
    title: 'Inspect page',
    description: 'Inspect interactive elements on an explicit browser profile and optional tab.',
    inputSchema: z.object({
      instance: instanceField,
      tabId: tabField,
      limit: z.number().int().min(1).max(200).default(40)
    }),
    annotations: { readOnlyHint: true }
  }, withErrorBoundary(async ({ instance, tabId, limit }) =>
    resultText(await bridgeCall(instance, { target: 'page', action: 'inspect', tabId, limit }))));

  server.registerTool('browser.read', {
    title: 'Read page element',
    description: 'Read text/value from an element. Prefer selector or another explicit locator.',
    inputSchema: z.object(locatorShape),
    annotations: { readOnlyHint: true }
  }, withErrorBoundary(async (args) =>
    resultText(await bridgeCall(args.instance, { target: 'page', action: 'read', ...locatorFrom(args) }))));

  server.registerTool('browser.click', {
    title: 'Click page element',
    description: 'Click an element in the selected browser instance.',
    inputSchema: z.object(locatorShape),
    annotations: { readOnlyHint: false, destructiveHint: false }
  }, withErrorBoundary(async (args) =>
    resultText(await bridgeCall(args.instance, { target: 'page', action: 'click', ...locatorFrom(args) }))));

  server.registerTool('browser.type', {
    title: 'Type into page element',
    description: 'Type text into an element in the selected browser instance.',
    inputSchema: z.object({
      ...locatorShape,
      value: z.string(),
      clear: z.boolean().default(true)
    }),
    annotations: { readOnlyHint: false, destructiveHint: false }
  }, withErrorBoundary(async (args) =>
    resultText(await bridgeCall(args.instance, {
      target: 'page', action: 'type', ...locatorFrom(args),
      value: args.value, clear: args.clear
    }))));

  server.registerTool('browser.check', {
    title: 'Check page control',
    description: 'Check a checkbox or compatible control in the selected browser instance.',
    inputSchema: z.object(locatorShape),
    annotations: { readOnlyHint: false, destructiveHint: false }
  }, withErrorBoundary(async (args) =>
    resultText(await bridgeCall(args.instance, { target: 'page', action: 'check', ...locatorFrom(args) }))));

  server.registerTool('browser.navigate', {
    title: 'Navigate tab',
    description: 'Navigate one explicit tab to an HTTP/HTTPS URL in the selected browser instance.',
    inputSchema: z.object({
      instance: instanceField,
      tabId: z.number().int().positive(),
      url: z.url()
    }),
    annotations: { readOnlyHint: false, destructiveHint: false }
  }, withErrorBoundary(async ({ instance, tabId, url }) =>
    resultText(await bridgeCall(instance, { target: 'browser', action: 'tab.navigate', tabId, url }))));

  server.registerTool('browser.screenshot', {
    title: 'Capture active tab',
    description: 'Capture the visible active tab in the selected browser instance.',
    inputSchema: z.object({ instance: instanceField }),
    annotations: { readOnlyHint: true }
  }, withErrorBoundary(async ({ instance }) => {
    const result = await bridgeCall(instance, { target: 'browser', action: 'screenshot', format: 'png' });
    const match = /^data:(image\/[^;]+);base64,(.+)$/.exec(String(result.dataUrl || ''));
    if (!match) return resultText(result);
    return {
      content: [
        { type: 'image', mimeType: match[1], data: match[2] },
        { type: 'text', text: JSON.stringify({ ok: true, tabId: result.tabId, title: result.title, url: result.url }, null, 2) }
      ]
    };
  }));

  server.registerTool('ssh.exec', {
    title: 'Run SSH command',
    description: 'Run an SSH command through a native profile. Requires POWER tier on the selected browser instance.',
    inputSchema: z.object({
      instance: instanceField,
      profile: z.string().min(1),
      command: z.string().min(1),
      timeoutMs: z.number().int().min(1000).max(120000).default(30000)
    }),
    annotations: { readOnlyHint: false, destructiveHint: true }
  }, withErrorBoundary(async ({ instance, profile, command, timeoutMs }) =>
    resultText(await bridgeCall(instance, {
      target: 'ssh', action: 'ssh.exec', profile, command, timeoutMs
    }))));

  return server;
}

serveStdio(() => buildServer());
console.error(`986Code MCP ${VERSION} listening on stdio`);

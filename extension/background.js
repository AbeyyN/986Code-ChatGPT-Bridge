const HOST_NAME = 'com.abeyytechxy.986code_bridge';
const VERSION = '0.1.0-alpha.3';

const CREDENTIAL_FIELD_RE = /(^|[_-])(password|passphrase|secret|token|cookie|session|api.?key|private.?key|authorization|bearer)([_-]|$)/i;
const AUDIT_REDACT_FIELDS = new Set(['value','text','profiledata','body','payload']);

function hasInlineCredential(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasInlineCredential);
  return Object.entries(value).some(([k,v]) => CREDENTIAL_FIELD_RE.test(k) || hasInlineCredential(v));
}

function sanitizeSshProfile(profile = {}) {
  return {
    host: String(profile.host || '').trim(),
    port: Math.max(1, Math.min(65535, Number(profile.port || 22))),
    username: String(profile.username || '').trim(),
    keyPath: String(profile.keyPath || '').trim(),
    authMethod: ['agent','keyfile'].includes(profile.authMethod) ? profile.authMethod : 'agent'
  };
}

function safeUrlForAudit(raw = '') {
  try { const u = new URL(String(raw)); return `${u.protocol}//${u.host}${u.pathname}`; }
  catch (_) { return String(raw).split(/[?#]/)[0]; }
}


function redactForAudit(value, key = '') {
  const lowerKey = String(key).toLowerCase();
  if (CREDENTIAL_FIELD_RE.test(key) || AUDIT_REDACT_FIELDS.has(lowerKey) || (lowerKey === 'command' && (value === null || typeof value !== 'object'))) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((v) => redactForAudit(v));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k,v] of Object.entries(value)) out[k] = k.toLowerCase() === 'url' ? safeUrlForAudit(v) : redactForAudit(v, k);
    return out;
  }
  return value;
}

async function migratePrivacyStorage() {
  const current = await chrome.storage.local.get(null);
  if (Number(current.privacySchemaVersion || 0) >= 1) return;
  const remove = Object.keys(current).filter((k) => CREDENTIAL_FIELD_RE.test(k));
  if (remove.length) await chrome.storage.local.remove(remove);
  const sanitizedProfiles = {};
  for (const [name, profile] of Object.entries(current.sshProfiles || {})) sanitizedProfiles[name] = sanitizeSshProfile(profile);
  await chrome.storage.local.set({
    sshProfiles: sanitizedProfiles,
    commandHistory: [],
    identityMode: 'user-session',
    credentialPolicy: 'native-owned',
    historyMode: 'metadata-redacted',
    privacySchemaVersion: 1,
    privacyMigratedAt: new Date().toISOString()
  });
}

function errText(error) {
  return String(error?.message || error || 'Unknown error');
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.id) throw new Error('No active tab');
  return tabs[0];
}

function isScriptableUrl(url = '') {
  return /^https?:|^file:/.test(url);
}

async function rememberWebTab(tab) {
  if (tab?.id && isScriptableUrl(tab.url || '')) {
    await chrome.storage.session.set({ lastWebTabId: tab.id });
  }
}

async function preferredWebTab(requestedTabId, command = {}) {
  if (requestedTabId) {
    const requested = await chrome.tabs.get(Number(requestedTabId));
    if (!isScriptableUrl(requested.url || '')) throw new Error('Requested tab is not a scriptable http(s)/file page.');
    return requested;
  }
  const active = await activeTab();
  if (isScriptableUrl(active.url || '')) {
    await rememberWebTab(active);
    return active;
  }
  if (command.allowRememberedTab === true) {
    const { lastWebTabId } = await chrome.storage.session.get({ lastWebTabId: null });
    if (lastWebTabId) {
      try {
        const last = await chrome.tabs.get(Number(lastWebTabId));
        if (isScriptableUrl(last.url || '')) return last;
      } catch (_) {}
    }
  }
  throw new Error('Safe target resolution blocked: the active tab is not scriptable. Provide an explicit tabId. Remembered-tab fallback is disabled unless allowRememberedTab=true.');
}

async function ensurePageBridge(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { channel: '986code-page', command: { action: 'ping' } });
    if (pong?.ok) return pong;
  } catch (_) {}
  await chrome.scripting.executeScript({ target: { tabId }, files: ['bridge-content.js'] });
  return await chrome.tabs.sendMessage(tabId, { channel: '986code-page', command: { action: 'ping' } });
}

async function pageCommand(command, requestedTabId) {
  const tab = await preferredWebTab(requestedTabId, command);
  if (!tab?.id) throw new Error('Target tab not found');
  if (!isScriptableUrl(tab.url || '')) throw new Error('This page is protected by the browser and cannot be scripted with the normal page bridge. Use a supported web page or Power Mode where applicable.');
  await ensurePageBridge(tab.id);
  const result = await chrome.tabs.sendMessage(tab.id, { channel: '986code-page', command });
  return { ...result, tabId: tab.id, tabTitle: tab.title, tabUrl: tab.url };
}

async function tabList() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.map((t) => ({ id: t.id, active: t.active, pinned: t.pinned, title: t.title, url: t.url, index: t.index }));
}

async function browserCommand(command) {
  const action = String(command.action || '').toLowerCase();
  switch (action) {
    case 'tab.list':
    case 'tabs':
      return { ok: true, tabs: await tabList() };
    case 'tab.new': {
      const tab = await chrome.tabs.create({ url: command.url || 'about:blank', active: command.active !== false });
      return { ok: true, tab: { id: tab.id, title: tab.title, url: tab.url } };
    }
    case 'tab.activate': {
      const tabId = Number(command.tabId);
      await chrome.tabs.update(tabId, { active: true });
      const tab = await chrome.tabs.get(tabId);
      if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
      return { ok: true, tabId };
    }
    case 'tab.close': {
      const tabId = Number(command.tabId || (await activeTab()).id);
      await chrome.tabs.remove(tabId);
      return { ok: true, tabId };
    }
    case 'tab.reload': {
      const tabId = Number(command.tabId || (await activeTab()).id);
      await chrome.tabs.reload(tabId, { bypassCache: Boolean(command.bypassCache) });
      return { ok: true, tabId };
    }
    case 'navigate':
    case 'tab.navigate': {
      const tabId = Number(command.tabId || (await activeTab()).id);
      const tab = await chrome.tabs.update(tabId, { url: String(command.url) });
      return { ok: true, tab: { id: tab.id, url: tab.url, title: tab.title } };
    }
    case 'capture':
    case 'screenshot': {
      const tab = await activeTab();
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: command.format === 'jpeg' ? 'jpeg' : 'png', quality: command.quality });
      return { ok: true, dataUrl, tabId: tab.id, title: tab.title, url: tab.url };
    }
    default:
      throw new Error(`Unsupported browser action: ${action}`);
  }
}

async function hasPermission(permission) {
  return chrome.permissions.contains({ permissions: [permission] });
}

async function cdp(command) {
  if (!(await hasPermission('debugger'))) throw new Error('Power Mode permission "debugger" is not enabled. Enable it in Options first.');
  const tab = command.tabId ? await chrome.tabs.get(Number(command.tabId)) : await activeTab();
  const target = { tabId: tab.id };
  try { await chrome.debugger.attach(target, '1.3'); } catch (error) {
    if (!errText(error).toLowerCase().includes('already attached')) throw error;
  }
  try {
    const action = String(command.action || '').toLowerCase();
    if (action === 'cdp.click') {
      const x = Number(command.x), y = Number(command.y);
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      return { ok: true, tabId: tab.id, x, y };
    }
    if (action === 'cdp.type') {
      await chrome.debugger.sendCommand(target, 'Input.insertText', { text: String(command.text ?? command.value ?? '') });
      return { ok: true, tabId: tab.id };
    }
    if (action === 'cdp.key') {
      const key = String(command.key || 'Enter');
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyDown', key, code: command.code || key, windowsVirtualKeyCode: Number(command.keyCode || 0) });
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', key, code: command.code || key, windowsVirtualKeyCode: Number(command.keyCode || 0) });
      return { ok: true, tabId: tab.id, key };
    }
    throw new Error(`Unsupported CDP action: ${action}`);
  } finally {
    if (command.keepAttached !== true) {
      try { await chrome.debugger.detach(target); } catch (_) {}
    }
  }
}

async function nativeCommand(command) {
  if (hasInlineCredential(command)) throw new Error('Inline credentials are blocked. Keep passwords, tokens, passphrases and private keys in the user-owned native/OS credential layer.');
  if (!(await hasPermission('nativeMessaging'))) throw new Error('Native Bridge permission is not enabled. Enable it in Options first.');
  const enriched = { ...command };
  if (enriched.profileData) enriched.profileData = sanitizeSshProfile(enriched.profileData);
  if ((String(command.target || '').toLowerCase() === 'ssh' || String(command.action || '').toLowerCase().startsWith('ssh.')) && command.profile && !command.profileData) {
    const { sshProfiles = {} } = await chrome.storage.local.get({ sshProfiles: {} });
    if (!sshProfiles[command.profile]) throw new Error(`SSH profile not found: ${command.profile}`);
    enriched.profileData = sanitizeSshProfile(sshProfiles[command.profile]);
  }
  return await chrome.runtime.sendNativeMessage(HOST_NAME, { version: VERSION, command: enriched });
}

async function executeSingle(command = {}) {
  const target = String(command.target || 'page').toLowerCase();
  if (target === 'page' || target === 'web') return await pageCommand(command, command.tabId);
  if (target === 'browser' || target === 'tab') return await browserCommand(command);
  if (target === 'cdp' || target === 'power') return await cdp(command);
  if (target === 'native' || target === 'ssh' || target === 'terminal') return await nativeCommand(command);
  throw new Error(`Unknown target: ${target}`);
}

async function executeBatch(commands = [], stopOnError = true) {
  const results = [];
  for (let i = 0; i < commands.length; i++) {
    try {
      const result = await executeSingle(commands[i]);
      results.push({ index: i, ...result });
      if (!result?.ok && stopOnError) break;
    } catch (error) {
      results.push({ index: i, ok: false, error: errText(error) });
      if (stopOnError) break;
    }
  }
  return { ok: results.every((r) => r.ok), results };
}

async function logRun(request, result) {
  const { historyEnabled = true, historyLimit = 100 } = await chrome.storage.local.get({ historyEnabled: true, historyLimit: 100 });
  if (!historyEnabled) return;
  const current = await chrome.storage.local.get({ commandHistory: [] });
  const history = Array.isArray(current.commandHistory) ? current.commandHistory : [];
  history.unshift({ at: new Date().toISOString(), request: redactForAudit(request), result: redactForAudit(result) });
  await chrome.storage.local.set({ commandHistory: history.slice(0, Math.max(10, Math.min(500, Number(historyLimit) || 100))) });
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try { await rememberWebTab(await chrome.tabs.get(tabId)); } catch (_) {}
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    try { await rememberWebTab(tab); } catch (_) {}
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await migratePrivacyStorage();
  await chrome.storage.local.set({
    installedVersion: VERSION,
    historyEnabled: true,
    historyLimit: 100,
    historyMode: 'metadata-redacted',
    identityMode: 'user-session',
    credentialPolicy: 'native-owned',
    requireConfirmation: true
  });
});

chrome.runtime.onStartup.addListener(() => { migratePrivacyStorage().catch(() => {}); });
migratePrivacyStorage().catch(() => {});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (!request || request.channel !== '986code-control') return;
  (async () => {
    if (request.type === 'info') {
      const perms = await chrome.permissions.getAll();
      const policy = await chrome.storage.local.get({ identityMode:'user-session', credentialPolicy:'native-owned', historyMode:'metadata-redacted' });
      return { ok: true, version: VERSION, extensionId: chrome.runtime.id, permissions: perms, ...policy };
    }
    if (request.type === 'execute') {
      const result = Array.isArray(request.commands)
        ? await executeBatch(request.commands, request.stopOnError !== false)
        : await executeSingle(request.command || {});
      await logRun(request, result);
      return result;
    }
    if (request.type === 'history.clear') {
      await chrome.storage.local.set({ commandHistory: [] });
      return { ok: true };
    }
    throw new Error(`Unknown request type: ${request.type}`);
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: errText(error) }));
  return true;
});

const HOST_NAME = 'com.abeyytechxy.986code_bridge';
const VERSION = '0.1.0-alpha.5';

const CREDENTIAL_FIELD_RE = /(^|[_-])(password|passphrase|secret|token|cookie|session|api.?key|private.?key|authorization|bearer)([_-]|$)/i;
const AUDIT_REDACT_FIELDS = new Set(['value','text','profiledata','body','payload']);

const TIER_DEFAULTS = { read: true, write: true, power: false };
let nativePort = null;
let nativeReady = false;
let nativeStatus = { connected:false, error:null, controlPlane:null, nativeVersion:null };
let nativeReconnectTimer = null;
const nativePending = new Map();

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

async function ensureInstanceIdentity() {
  const current = await chrome.storage.local.get({ instanceId:null, instanceLabel:null, permissionTiers:TIER_DEFAULTS });
  let changed = false;
  if (!current.instanceId) { current.instanceId = uuid(); changed = true; }
  if (!current.instanceLabel) { current.instanceLabel = `OPERA-${String(current.instanceId).slice(0,8).toUpperCase()}`; changed = true; }
  current.permissionTiers = { ...TIER_DEFAULTS, ...(current.permissionTiers || {}) };
  if (changed) await chrome.storage.local.set({ instanceId:current.instanceId, instanceLabel:current.instanceLabel, permissionTiers:current.permissionTiers });
  return current;
}

function requiredTier(command = {}) {
  const target = String(command.target || 'page').toLowerCase();
  const action = String(command.action || '').toLowerCase();
  if (['cdp','power','native','ssh','terminal'].includes(target) || action.startsWith('cdp.') || action.startsWith('ssh.')) return 'power';
  if (['browser','tab'].includes(target)) return ['tab.list','tabs','capture','screenshot'].includes(action) ? 'read' : 'write';
  return ['read','inspect','ping','wait'].includes(action) ? 'read' : 'write';
}

async function enforceTier(command = {}) {
  const tier = requiredTier(command);
  const { permissionTiers = TIER_DEFAULTS } = await chrome.storage.local.get({ permissionTiers:TIER_DEFAULTS });
  const effective = { ...TIER_DEFAULTS, ...permissionTiers };
  if (effective[tier] !== true) throw new Error(`${tier.toUpperCase()} permission tier is disabled for this 986Code browser instance.`);
  return tier;
}

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


async function handleNativePortMessage(message = {}) {
  if (message.type === 'hello.ack') {
    nativeReady = message.ok === true;
    setNativeStatus({ connected:nativeReady, error:nativeReady ? null : (message.error || 'Native hello failed'), controlPlane:message.controlPlane || null, nativeVersion:message.nativeVersion || null });
    if (nativeReady) migrateSshProfilesToNative().catch((error) => setNativeStatus({ error:error.message }));
    return;
  }
  if (message.type === 'execute') {
    const requestId = String(message.requestId || '');
    let result;
    try { result = await executeSingle(message.command || {}); }
    catch (error) { result = { ok:false, error:errText(error) }; }
    try { nativePort?.postMessage({ type:'result', requestId, result }); } catch (_) {}
    await logRun({ channel:'986code-native-control', type:'execute', command:message.command || {} }, result);
    return;
  }
  if (message.type === 'native.response') {
    const pending = nativePending.get(String(message.requestId || ''));
    if (!pending) return;
    clearTimeout(pending.timer);
    nativePending.delete(String(message.requestId));
    pending.resolve(message.result || { ok:false, error:'Empty native response' });
    return;
  }
  if (message.type === 'error') setNativeStatus({ error:message.error || 'Native host error' });
}

async function connectControlPlane() {
  if (!(await hasPermission('nativeMessaging'))) {
    setNativeStatus({ connected:false, error:'nativeMessaging permission is disabled', controlPlane:null });
    return false;
  }
  if (nativePort) return nativeReady;
  const state = await ensureInstanceIdentity();
  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);
    nativeReady = false;
    setNativeStatus({ connected:false, error:null, controlPlane:null });
    nativePort.onMessage.addListener((message) => { handleNativePortMessage(message).catch((error) => setNativeStatus({ error:error.message })); });
    nativePort.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message || 'Native host disconnected';
      nativePort = null; nativeReady = false;
      setNativeStatus({ connected:false, error, controlPlane:null });
      for (const [id,pending] of nativePending) { clearTimeout(pending.timer); pending.reject(new Error(error)); nativePending.delete(id); }
      scheduleNativeReconnect();
    });
    nativePort.postMessage({ type:'hello', instanceId:state.instanceId, label:state.instanceLabel, permissions:state.permissionTiers, extensionVersion:VERSION });
    return true;
  } catch (error) {
    nativePort = null; nativeReady = false;
    setNativeStatus({ connected:false, error:errText(error), controlPlane:null });
    scheduleNativeReconnect();
    return false;
  }
}

async function migratePrivacyStorage() {
  const current = await chrome.storage.local.get(null);
  if (Number(current.privacySchemaVersion || 0) >= 2) return;
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
    privacySchemaVersion: 2,
    privacyMigratedAt: new Date().toISOString()
  });
}


function setNativeStatus(patch) {
  nativeStatus = { ...nativeStatus, ...patch };
  chrome.storage.session.set({ nativeStatus }).catch(() => {});
}

function scheduleNativeReconnect(delay = 3000) {
  clearTimeout(nativeReconnectTimer);
  nativeReconnectTimer = setTimeout(() => { connectControlPlane().catch(() => {}); }, delay);
}

async function nativeRequest(action, payload = {}, timeoutMs = 30000) {
  await connectControlPlane();
  if (!nativePort || !nativeReady) throw new Error(nativeStatus.error || 'Native control plane is not ready.');
  const requestId = uuid();
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { nativePending.delete(requestId); reject(new Error(`Native request timeout: ${action}`)); }, timeoutMs);
    nativePending.set(requestId, { resolve, reject, timer });
    nativePort.postMessage({ type:'native.request', requestId, action, ...payload });
  });
}

async function migrateSshProfilesToNative() {
  const current = await chrome.storage.local.get({ sshProfiles:{}, sshProfilesMigrated:false });
  if (current.sshProfilesMigrated) return;
  for (const [name, profile] of Object.entries(current.sshProfiles || {})) {
    const result = await nativeRequest('profile.save', { name, profile:sanitizeSshProfile(profile) });
    if (!result?.ok) throw new Error(result?.error || `Failed to migrate SSH profile ${name}`);
  }
  await chrome.storage.local.remove('sshProfiles');
  await chrome.storage.local.set({ sshProfilesMigrated:true, sshProfilesMigratedAt:new Date().toISOString() });
}

async function syncNativePolicy() {
  if (!nativePort || !nativeReady) return;
  const state = await ensureInstanceIdentity();
  nativePort.postMessage({ type:'policy.update', requestId:uuid(), label:state.instanceLabel, permissions:state.permissionTiers });
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
  if (!(await hasPermission('debugger'))) throw new Error('Power Mode permission "debugger" is unavailable. Reload or reinstall this extension build.');
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
  if (!(await hasPermission('nativeMessaging'))) throw new Error('Native Control Plane permission is not enabled. Enable it in Options first.');
  const target = String(command.target || '').toLowerCase();
  const action = String(command.action || '').toLowerCase();
  if (target === 'ssh' || action.startsWith('ssh.')) return await nativeRequest('ssh.exec', { command:{ ...command, profileData:undefined } }, Number(command.timeoutMs || 30000));
  return await nativeRequest('native.info');
}

async function executeSingle(command = {}) {
  await enforceTier(command);
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
  const state = await ensureInstanceIdentity();
  await chrome.storage.local.set({
    installedVersion: VERSION,
    historyEnabled: true,
    historyLimit: 100,
    historyMode: 'metadata-redacted',
    identityMode: 'user-session',
    credentialPolicy: 'native-owned',
    permissionTiers:state.permissionTiers,
    requireConfirmation: true
  });
  connectControlPlane().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => { Promise.all([migratePrivacyStorage(), ensureInstanceIdentity()]).then(() => connectControlPlane()).catch(() => {}); });
chrome.permissions.onAdded.addListener((permissions) => { if ((permissions.permissions || []).includes('nativeMessaging')) connectControlPlane().catch(() => {}); });
chrome.permissions.onRemoved.addListener((permissions) => { if ((permissions.permissions || []).includes('nativeMessaging')) { try { nativePort?.disconnect(); } catch (_) {} nativePort=null; nativeReady=false; setNativeStatus({connected:false,error:'nativeMessaging permission removed',controlPlane:null}); } });
Promise.all([migratePrivacyStorage(), ensureInstanceIdentity()]).then(() => connectControlPlane()).catch(() => {});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (!request || request.channel !== '986code-control') return;
  (async () => {
    if (request.type === 'info') {
      const perms = await chrome.permissions.getAll();
      const policy = await chrome.storage.local.get({ identityMode:'user-session', credentialPolicy:'native-owned', historyMode:'metadata-redacted' });
      const state = await ensureInstanceIdentity();
      return { ok:true, version:VERSION, extensionId:chrome.runtime.id, permissions:perms, ...policy, instanceId:state.instanceId, instanceLabel:state.instanceLabel, permissionTiers:state.permissionTiers, nativeStatus };
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
    if (request.type === 'instance.update') {
      const state = await ensureInstanceIdentity();
      const label = String(request.instanceLabel || state.instanceLabel).trim().slice(0, 64) || state.instanceLabel;
      const tiers = { ...TIER_DEFAULTS, ...(request.permissionTiers || state.permissionTiers) };
      tiers.read = tiers.read !== false; tiers.write = tiers.write === true; tiers.power = tiers.power === true;
      await chrome.storage.local.set({ instanceLabel:label, permissionTiers:tiers });
      await syncNativePolicy();
      return { ok:true, instanceId:state.instanceId, instanceLabel:label, permissionTiers:tiers };
    }
    if (request.type === 'native.connect') {
      const connected = await connectControlPlane();
      return { ok:connected || nativeReady, nativeStatus };
    }
    if (request.type === 'native.status') return { ok:true, nativeStatus };
    if (request.type === 'native.profile.list') return await nativeRequest('profile.list');
    if (request.type === 'native.profile.save') return await nativeRequest('profile.save', { name:request.name, profile:sanitizeSshProfile(request.profile || {}) });
    if (request.type === 'native.profile.delete') return await nativeRequest('profile.delete', { name:request.name });
    throw new Error(`Unknown request type: ${request.type}`);
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: errText(error) }));
  return true;
});

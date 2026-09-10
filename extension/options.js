const $ = (id) => document.getElementById(id);
const send = (payload) => chrome.runtime.sendMessage({ channel:'986code-control', ...payload });

async function info() {
  const r = await send({ type:'info' });
  $('extensionId').textContent = r.extensionId || chrome.runtime.id;
  $('identityMode').textContent = r.identityMode || 'user-session';
  $('credentialPolicy').textContent = r.credentialPolicy || 'native-owned';
  $('instanceId').textContent = r.instanceId || 'unknown';
  $('instanceLabel').value = r.instanceLabel || '';
  $('tierRead').checked = r.permissionTiers?.read !== false;
  $('tierWrite').checked = r.permissionTiers?.write === true;
  $('tierPower').checked = r.permissionTiers?.power === true;
  renderNative(r.nativeStatus || {});
  return r;
}

async function has(permission) {
  return chrome.permissions.contains({ permissions:[permission] });
}

async function updatePermButtons() {
  const dbg = await has('debugger');
  const nat = await has('nativeMessaging');
  $('debuggerBtn').textContent = dbg ? 'Disable' : 'Enable';
  $('nativeBtn').textContent = nat ? 'Disable' : 'Enable';
  $('debuggerBtn').dataset.enabled = String(dbg);
  $('nativeBtn').dataset.enabled = String(nat);
}
function renderNative(status = {}) {
  const connected = status.connected === true;
  $('nativeStatus').textContent = connected ? `connected · ${status.nativeVersion || 'native'}` : `disconnected${status.error ? ` · ${status.error}` : ''}`;
  $('nativeEndpoint').textContent = status.controlPlane ? `${status.controlPlane.host}:${status.controlPlane.port}` : 'not connected';
}

async function refreshNativeStatus() {
  try {
    const r = await send({ type:'native.status' });
    renderNative(r.nativeStatus || {});
    return r.nativeStatus || {};
  } catch (error) {
    renderNative({ connected:false, error:String(error.message || error) });
    return {};
  }
}

async function togglePermission(permission) {
  const enabled = await has(permission);
  let changed;
  if (enabled) changed = await chrome.permissions.remove({ permissions:[permission] });
  else changed = await chrome.permissions.request({ permissions:[permission] });
  $('permStatus').textContent = changed ? `${permission}: ${enabled ? 'disabled' : 'enabled'}.` : `${permission}: permission unchanged.`;
  await updatePermButtons();
  if (permission === 'nativeMessaging' && !enabled && changed) {
    await send({ type:'native.connect' }).catch(() => null);
    setTimeout(refreshNativeStatus, 300);
  }
}

function safe(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function profileHtml(name, p) {
  const ref = p.authMethod === 'keyfile' ? (p.keyPath || 'key file') : 'SSH agent / OS vault';
  return `<div class="profile"><div><strong>${safe(name)}</strong><br><small>${safe(p.username)}@${safe(p.host)}:${safe(p.port || 22)} · ${safe(p.authMethod || 'agent')} · ${safe(ref)}</small></div><button data-delete="${safe(name)}">Delete</button></div>`;
}

async function loadProfiles() {
  try {
    const r = await send({ type:'native.profile.list' });
    if (!r?.ok) throw new Error(r?.error || 'Native profile service unavailable');
    const profiles = r.profiles || {};
    $('profiles').innerHTML = Object.entries(profiles).map(([n,p]) => profileHtml(n,p)).join('') || '<p class="note">No native SSH profiles yet.</p>';
    $('profiles').querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
      const result = await send({ type:'native.profile.delete', name:btn.dataset.delete });
      if (!result?.ok) return alert(result?.error || 'Delete failed.');
      await loadProfiles();
    }));
  } catch (error) {
    $('profiles').innerHTML = `<p class="note">Native control plane unavailable: ${safe(error.message || error)}</p>`;
  }
}

async function saveInstance() {
  const r = await send({ type:'instance.update', instanceLabel:$('instanceLabel').value.trim() });
  if (!r?.ok) return alert(r?.error || 'Failed to save instance.');
  $('instanceId').textContent = r.instanceId;
  $('instanceLabel').value = r.instanceLabel;
  alert('Instance identity saved.');
}
async function saveTiers() {
  const permissionTiers = {
    read:$('tierRead').checked,
    write:$('tierWrite').checked,
    power:$('tierPower').checked
  };
  const r = await send({ type:'instance.update', instanceLabel:$('instanceLabel').value.trim(), permissionTiers });
  if (!r?.ok) return alert(r?.error || 'Failed to save permission tiers.');
  $('tierRead').checked = r.permissionTiers.read;
  $('tierWrite').checked = r.permissionTiers.write;
  $('tierPower').checked = r.permissionTiers.power;
  alert('Permission tiers saved.');
}

$('debuggerBtn').addEventListener('click', () => togglePermission('debugger'));
$('nativeBtn').addEventListener('click', () => togglePermission('nativeMessaging'));
$('saveIdentity').addEventListener('click', saveInstance);
$('saveTiers').addEventListener('click', saveTiers);
$('connectNative').addEventListener('click', async () => {
  const r = await send({ type:'native.connect' });
  renderNative(r.nativeStatus || {});
  if (!r?.ok) alert(r.nativeStatus?.error || 'Native control plane is not connected.');
  else await loadProfiles();
});

$('saveProfile').addEventListener('click', async () => {
  const name = $('profileName').value.trim();
  const host = $('profileHost').value.trim();
  const username = $('profileUser').value.trim();
  if (!name || !host || !username) return alert('Profile name, host and username are required.');
  const profile = { host, port:Number($('profilePort').value || 22), username, authMethod:$('profileAuth').value || 'agent', keyPath:$('profileKey').value.trim() };
  const r = await send({ type:'native.profile.save', name, profile });
  if (!r?.ok) return alert(r?.error || 'Native profile save failed.');
  await loadProfiles();
});
$('saveSettings').addEventListener('click', async () => {
  await chrome.storage.local.set({ historyEnabled:$('historyEnabled').checked, historyLimit:Number($('historyLimit').value || 100) });
  alert('Settings saved.');
});
$('clearHistory').addEventListener('click', async () => {
  await send({ type:'history.clear' });
  alert('Command history cleared.');
});

(async () => {
  await info();
  await updatePermButtons();
  const settings = await chrome.storage.local.get({ historyEnabled:true, historyLimit:100 });
  $('historyEnabled').checked = settings.historyEnabled !== false;
  $('historyLimit').value = settings.historyLimit || 100;
  if (await has('nativeMessaging')) {
    await send({ type:'native.connect' }).catch(() => null);
    await refreshNativeStatus();
    await loadProfiles();
  } else {
    renderNative({ connected:false, error:'nativeMessaging permission is disabled' });
    $('profiles').innerHTML = '<p class="note">Enable Native Messaging to manage native SSH profiles.</p>';
  }
  setInterval(refreshNativeStatus, 2500);
})();

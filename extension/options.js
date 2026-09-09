const $ = (id) => document.getElementById(id);

async function info() {
  const r = await chrome.runtime.sendMessage({ channel:'986code-control', type:'info' });
  $('extensionId').textContent = r.extensionId || chrome.runtime.id;
  $('identityMode').textContent = r.identityMode || 'user-session';
  $('credentialPolicy').textContent = r.credentialPolicy || 'native-owned';
  return r;
}

async function has(permission) { return chrome.permissions.contains({ permissions:[permission] }); }

async function updatePermButtons() {
  const dbg = await has('debugger');
  const nat = await has('nativeMessaging');
  $('debuggerBtn').textContent = dbg ? 'Disable' : 'Enable';
  $('nativeBtn').textContent = nat ? 'Disable' : 'Enable';
  $('debuggerBtn').dataset.enabled = String(dbg);
  $('nativeBtn').dataset.enabled = String(nat);
}

async function togglePermission(permission, btn) {
  const enabled = await has(permission);
  let changed;
  if (enabled) changed = await chrome.permissions.remove({ permissions:[permission] });
  else changed = await chrome.permissions.request({ permissions:[permission] });
  $('permStatus').textContent = changed ? `${permission}: ${enabled ? 'disabled' : 'enabled'}.` : `${permission}: permission unchanged.`;
  await updatePermButtons();
}

function profileHtml(name, p) {
  const safe = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return `<div class="profile"><div><strong>${safe(name)}</strong><br><small>${safe(p.username)}@${safe(p.host)}:${safe(p.port || 22)} · ${safe(p.authMethod || 'agent')} · ${safe(p.keyPath || 'SSH agent/OS vault')}</small></div><button data-delete="${safe(name)}">Delete</button></div>`;
}

async function loadProfiles() {
  const { sshProfiles = {} } = await chrome.storage.local.get({ sshProfiles:{} });
  $('profiles').innerHTML = Object.entries(sshProfiles).map(([n,p]) => profileHtml(n,p)).join('') || '<p class="note">No profiles yet.</p>';
  $('profiles').querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    const { sshProfiles = {} } = await chrome.storage.local.get({ sshProfiles:{} });
    delete sshProfiles[btn.dataset.delete];
    await chrome.storage.local.set({ sshProfiles });
    await loadProfiles();
  }));
}

$('debuggerBtn').addEventListener('click', () => togglePermission('debugger', $('debuggerBtn')));
$('nativeBtn').addEventListener('click', () => togglePermission('nativeMessaging', $('nativeBtn')));
$('saveProfile').addEventListener('click', async () => {
  const name = $('profileName').value.trim();
  const host = $('profileHost').value.trim();
  const username = $('profileUser').value.trim();
  if (!name || !host || !username) return alert('Profile name, host and username are required.');
  const { sshProfiles = {} } = await chrome.storage.local.get({ sshProfiles:{} });
  sshProfiles[name] = { host, port:Number($('profilePort').value || 22), username, authMethod:$('profileAuth').value || 'agent', keyPath:$('profileKey').value.trim() };
  await chrome.storage.local.set({ sshProfiles });
  await loadProfiles();
});
$('saveSettings').addEventListener('click', async () => {
  await chrome.storage.local.set({ historyEnabled:$('historyEnabled').checked, historyLimit:Number($('historyLimit').value || 100) });
  alert('Settings saved.');
});
$('clearHistory').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ channel:'986code-control', type:'history.clear' });
  alert('Command history cleared.');
});

(async () => {
  await info();
  await updatePermButtons();
  const settings = await chrome.storage.local.get({ historyEnabled:true, historyLimit:100 });
  $('historyEnabled').checked = settings.historyEnabled !== false;
  $('historyLimit').value = settings.historyLimit || 100;
  await loadProfiles();
})();

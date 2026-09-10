const state = document.getElementById('state');
const cmdOut = document.getElementById('command');
const resOut = document.getElementById('result');
const resultCard = document.getElementById('resultCard');
const params = new URLSearchParams(location.search);

async function status() {
  if (params.get('reload') === '1') {
    state.textContent = 'RELOADING';
    document.title = '986Code Bridge: RELOADING';
    setTimeout(() => chrome.runtime.reload(), 250);
    return;
  }
  cmdOut.textContent = 'URL payload execution was removed in v0.1.0-alpha.4.\nUse the native loopback control plane or the popup command console.';
  const info = await chrome.runtime.sendMessage({ channel:'986code-control', type:'info' });
  resOut.textContent = JSON.stringify({
    ok:true,
    version:info.version,
    instanceId:info.instanceId,
    instanceLabel:info.instanceLabel,
    permissionTiers:info.permissionTiers,
    nativeStatus:info.nativeStatus
  }, null, 2);
  state.textContent = info.nativeStatus?.connected ? 'CONTROL PLANE READY' : 'LOCAL MODE';
  resultCard.classList.remove('error');
  document.title = '986Code Bridge: SAFE INGRESS';
}

status().catch((error) => {
  state.textContent = 'FAILED';
  resultCard.classList.add('error');
  resOut.textContent = JSON.stringify({ ok:false, error:String(error?.message || error) }, null, 2);
});

const params = new URLSearchParams(location.search);
const state = document.getElementById('state');
const cmdOut = document.getElementById('command');
const resOut = document.getElementById('result');
const resultCard = document.getElementById('resultCard');

function decodePayload(raw) {
  if (!raw) throw new Error('Missing payload query parameter.');
  if (params.get('encoding') === 'b64') {
    const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = decodeURIComponent(escape(atob(normalized)));
    return JSON.parse(decoded);
  }
  return JSON.parse(raw);
}

if (params.get('reload') === '1') { state.textContent='RELOADING'; document.title='986Code Bridge: RELOADING'; setTimeout(() => chrome.runtime.reload(), 300); } else
(async () => {
  try {
    const payload = decodePayload(params.get('payload'));
    const tabId = params.get('tabId');
    if (tabId) {
      if (Array.isArray(payload)) payload.forEach((c) => { if (c && !c.tabId && ['page','web','cdp','power'].includes(String(c.target || 'page').toLowerCase())) c.tabId = Number(tabId); });
      else if (payload && !payload.tabId && ['page','web','cdp','power'].includes(String(payload.target || 'page').toLowerCase())) payload.tabId = Number(tabId);
    }
    cmdOut.textContent = JSON.stringify(payload, null, 2);
    const response = await chrome.runtime.sendMessage({
      channel: '986code-control',
      type: 'execute',
      ...(Array.isArray(payload) ? { commands: payload } : { command: payload })
    });
    resOut.textContent = JSON.stringify(response, null, 2);
    state.textContent = response?.ok ? 'OK' : 'FAILED';
    resultCard.classList.toggle('error', !response?.ok);
    document.title = response?.ok ? '986Code Bridge: OK' : '986Code Bridge: FAILED';
  } catch (error) {
    const response = { ok:false, error:String(error?.message || error) };
    resOut.textContent = JSON.stringify(response, null, 2);
    state.textContent = 'FAILED';
    resultCard.classList.add('error');
    document.title = '986Code Bridge: FAILED';
  }
})();

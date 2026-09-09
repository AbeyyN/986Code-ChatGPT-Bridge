const $ = (id) => document.getElementById(id);
const command = $('command');
const result = $('result');
const mode = $('mode');

const templates = {
  click: { target: 'page', action: 'click', text: 'Upload new add-on' },
  type: { target: 'page', action: 'type', selector: 'input', value: 'Hello from 986Code', clear: true },
  check: { target: 'page', action: 'check', label: 'I agree' },
  scroll: { target: 'page', action: 'scroll', y: 600 },
  read: { target: 'page', action: 'read', selector: 'body' },
  tabs: { target: 'browser', action: 'tab.list' }
};

function pretty(value) { return JSON.stringify(value, null, 2); }
function setResult(value, isError = false) {
  result.textContent = typeof value === 'string' ? value : pretty(value);
  document.querySelector('.result-card').classList.toggle('error', isError);
}

async function send(payload) {
  return await chrome.runtime.sendMessage({ channel: '986code-control', ...payload });
}

async function refreshTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('tabTitle').textContent = tab?.title || 'No active tab';
  $('tabUrl').textContent = tab?.url || '';
  $('statusDot').className = `dot ${/^https?:|^file:/.test(tab?.url || '') ? 'ok' : 'bad'}`;
}

async function run() {
  $('runBtn').disabled = true;
  $('runBtn').textContent = 'Running…';
  try {
    const parsed = JSON.parse(command.value);
    const payload = mode.value === 'batch'
      ? { type: 'execute', commands: Array.isArray(parsed) ? parsed : parsed.commands }
      : { type: 'execute', command: parsed };
    const response = await send(payload);
    setResult(response, !response?.ok);
  } catch (error) {
    setResult({ ok: false, error: String(error.message || error) }, true);
  } finally {
    $('runBtn').disabled = false;
    $('runBtn').textContent = 'Run command';
    await refreshTab();
  }
}

document.querySelectorAll('[data-template]').forEach((btn) => {
  btn.addEventListener('click', () => {
    mode.value = 'single';
    command.value = pretty(templates[btn.dataset.template]);
  });
});

$('inspectBtn').addEventListener('click', async () => {
  command.value = pretty({ target: 'page', action: 'inspect', limit: 20 });
  mode.value = 'single';
  await run();
});
$('runBtn').addEventListener('click', run);
$('clearBtn').addEventListener('click', () => { command.value = ''; setResult('Ready.'); });
$('copyBtn').addEventListener('click', async () => { await navigator.clipboard.writeText(result.textContent); });
$('optionsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
mode.addEventListener('change', () => {
  if (mode.value === 'batch') command.value = pretty([templates.click, { target:'page', action:'sleep', ms:300 }, templates.read]);
});

command.value = pretty(templates.click);
refreshTab().catch(() => {});

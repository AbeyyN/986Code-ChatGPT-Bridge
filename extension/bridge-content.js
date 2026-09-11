(() => {
  if (window.__986CodeBridgeInstalled) return;
  window.__986CodeBridgeInstalled = true;

  const BRIDGE_VERSION = '0.1.0-alpha.5';
  const normalize = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/([ #;?%&,.+*~\\':"!^$[\]()=>|/@])/g, '\\$1');
  }

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity || 1) !== 0;
  }

  function elementInfo(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName?.toLowerCase() || null,
      id: el.id || null,
      name: el.getAttribute?.('name') || null,
      type: el.getAttribute?.('type') || null,
      role: el.getAttribute?.('role') || null,
      text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      value: 'value' in el ? String(el.value ?? '').slice(0, 300) : null,
      checked: 'checked' in el ? Boolean(el.checked) : null,
      disabled: 'disabled' in el ? Boolean(el.disabled) : null,
      rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
    };
  }

  function byText(text, exact = false) {
    const needle = normalize(text);
    if (!needle) return null;
    const preferred = [
      'button','a','label','input','textarea','select','option','summary',
      '[role="button"]','[role="checkbox"]','[role="radio"]','[role="tab"]','[role="menuitem"]','[role="link"]'
    ];
    const nodes = Array.from(document.querySelectorAll(preferred.join(','))).filter(visible);
    const score = (el) => {
      const candidates = [
        el.innerText, el.textContent, el.getAttribute('aria-label'), el.getAttribute('title'),
        el.getAttribute('placeholder'), el.value
      ].map(normalize).filter(Boolean);
      if (exact && candidates.some((c) => c === needle)) return 100;
      if (!exact && candidates.some((c) => c === needle)) return 95;
      if (!exact && candidates.some((c) => c.startsWith(needle))) return 85;
      if (!exact && candidates.some((c) => c.includes(needle))) return 70;
      return 0;
    };
    return nodes.map((el) => ({ el, s: score(el) })).filter((x) => x.s > 0).sort((a,b) => b.s - a.s)[0]?.el || null;
  }

  function byLabel(text) {
    const needle = normalize(text);
    for (const label of document.querySelectorAll('label')) {
      if (!visible(label) || !normalize(label.innerText || label.textContent).includes(needle)) continue;
      if (label.htmlFor) {
        const linked = document.getElementById(label.htmlFor);
        if (linked) return linked;
      }
      const nested = label.querySelector('input,textarea,select,[contenteditable="true"]');
      if (nested) return nested;
    }
    return null;
  }

  function byRole(role, name) {
    const candidates = Array.from(document.querySelectorAll(`[role="${cssEscape(role)}"]`)).filter(visible);
    if (!name) return candidates[0] || null;
    const needle = normalize(name);
    return candidates.find((el) => [el.innerText, el.textContent, el.getAttribute('aria-label'), el.getAttribute('title')].some((v) => normalize(v).includes(needle))) || null;
  }

  function resolveElement(cmd = {}) {
    if (Number.isFinite(cmd.x) && Number.isFinite(cmd.y)) return document.elementFromPoint(cmd.x, cmd.y);
    if (cmd.selector) {
      try { const el = document.querySelector(cmd.selector); if (el) return el; } catch (_) {}
    }
    if (cmd.label) {
      const el = byLabel(cmd.label); if (el) return el;
    }
    if (cmd.role) {
      const el = byRole(cmd.role, cmd.name || cmd.text); if (el) return el;
    }
    if (cmd.placeholder) {
      const needle = normalize(cmd.placeholder);
      const el = Array.from(document.querySelectorAll('input,textarea')).find((n) => normalize(n.getAttribute('placeholder')).includes(needle) && visible(n));
      if (el) return el;
    }
    if (cmd.text) {
      const el = byText(cmd.text, Boolean(cmd.exact)); if (el) return el;
    }
    if (cmd.name) {
      const candidates = document.querySelectorAll(`[name="${cssEscape(cmd.name)}"],#${cssEscape(cmd.name)}`);
      for (const el of candidates) if (visible(el)) return el;
    }
    return null;
  }

  function dispatchClick(el, cmd = {}) {
    const rect = el.getBoundingClientRect();
    const x = Number.isFinite(cmd.x) ? cmd.x : rect.left + rect.width / 2;
    const y = Number.isFinite(cmd.y) ? cmd.y : rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: 1, view: window };
    for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {
      const Ctor = type.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(type, opts));
    }
  }

  function setNativeValue(el, value) {
    const tag = el.tagName?.toLowerCase();
    if (tag === 'input') {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter ? setter.call(el, value) : (el.value = value);
    } else if (tag === 'textarea') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter ? setter.call(el, value) : (el.value = value);
    } else if (el.isContentEditable) {
      el.textContent = value;
    } else if ('value' in el) {
      el.value = value;
    }
  }

  function inputEvents(el) {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  async function typeInto(el, value, cmd = {}) {
    el.focus({ preventScroll: false });
    if (cmd.clear !== false) {
      if (el.isContentEditable) el.textContent = '';
      else if ('value' in el) setNativeValue(el, '');
      inputEvents(el);
    }
    const text = String(value ?? '');
    const delay = Math.max(0, Number(cmd.delay || 0));
    if (delay > 0 && !el.isContentEditable && 'value' in el) {
      let current = cmd.clear === false ? String(el.value ?? '') : '';
      for (const ch of text) {
        current += ch;
        setNativeValue(el, current);
        inputEvents(el);
        await sleep(delay);
      }
    } else {
      const current = cmd.clear === false && 'value' in el ? String(el.value ?? '') : '';
      setNativeValue(el, current + text);
      inputEvents(el);
    }
  }

  function keyboardEvent(type, key, cmd = {}) {
    const target = document.activeElement || document.body;
    const init = {
      key,
      code: cmd.code || key,
      bubbles: true,
      cancelable: true,
      ctrlKey: Boolean(cmd.ctrl),
      shiftKey: Boolean(cmd.shift),
      altKey: Boolean(cmd.alt),
      metaKey: Boolean(cmd.meta)
    };
    target.dispatchEvent(new KeyboardEvent(type, init));
  }

  function pageSummary(limit = 30) {
    const pick = (selector) => Array.from(document.querySelectorAll(selector)).filter(visible).slice(0, limit).map(elementInfo);
    return {
      title: document.title,
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      activeElement: elementInfo(document.activeElement),
      buttons: pick('button,[role="button"],input[type="button"],input[type="submit"]'),
      inputs: pick('input,textarea,select,[contenteditable="true"]'),
      checks: pick('input[type="checkbox"],input[type="radio"],[role="checkbox"],[role="radio"]'),
      links: pick('a[href],[role="link"]')
    };
  }

  async function waitFor(cmd) {
    const timeout = Math.max(100, Number(cmd.timeout || 10000));
    const interval = Math.max(50, Number(cmd.interval || 200));
    const start = performance.now();
    while (performance.now() - start < timeout) {
      const el = resolveElement(cmd);
      if (el) return { ok: true, element: elementInfo(el), waitedMs: Math.round(performance.now() - start) };
      await sleep(interval);
    }
    return { ok: false, error: 'Element not found before timeout', waitedMs: Math.round(performance.now() - start) };
  }

  async function run(cmd = {}) {
    const action = String(cmd.action || '').toLowerCase();
    if (!action) return { ok: false, error: 'Missing action' };

    if (action === 'ping') return { ok: true, bridgeVersion: BRIDGE_VERSION, title: document.title, url: location.href };
    if (action === 'inspect' || action === 'summary') return { ok: true, data: pageSummary(Number(cmd.limit || 30)) };
    if (action === 'wait') return await waitFor(cmd);
    if (action === 'sleep') { await sleep(Math.max(0, Number(cmd.ms || 500))); return { ok: true }; }

    if (action === 'scroll') {
      if (cmd.selector || cmd.text || cmd.label || cmd.role) {
        const el = resolveElement(cmd);
        if (!el) return { ok: false, error: 'Element not found' };
        el.scrollIntoView({ behavior: cmd.behavior || 'smooth', block: cmd.block || 'center', inline: 'nearest' });
        return { ok: true, element: elementInfo(el) };
      }
      const x = Number(cmd.x || 0);
      const y = Number(cmd.y ?? cmd.amount ?? 500);
      window.scrollBy({ left: x, top: y, behavior: cmd.behavior || 'smooth' });
      return { ok: true, scrollX, scrollY };
    }

    let el = resolveElement(cmd);
    if (!el && (action === 'key' || action === 'press')) el = document.activeElement || document.body;
    if (!el) return { ok: false, error: 'Element not found', query: { selector: cmd.selector, text: cmd.text, label: cmd.label, role: cmd.role, name: cmd.name } };

    if (cmd.scrollIntoView !== false && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });

    switch (action) {
      case 'click':
      case 'tap':
        dispatchClick(el, cmd);
        return { ok: true, element: elementInfo(el) };
      case 'focus':
        el.focus();
        return { ok: true, element: elementInfo(el) };
      case 'type':
      case 'write':
      case 'fill':
        await typeInto(el, cmd.value ?? cmd.textValue ?? '', cmd);
        return { ok: true, element: elementInfo(el) };
      case 'check':
      case 'uncheck':
      case 'toggle': {
        const desired = action === 'check' ? true : action === 'uncheck' ? false : !Boolean(el.checked);
        if ('checked' in el) {
          if (Boolean(el.checked) !== desired) dispatchClick(el, cmd);
          if (Boolean(el.checked) !== desired) {
            el.checked = desired;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } else {
          dispatchClick(el, cmd);
        }
        return { ok: true, element: elementInfo(el) };
      }
      case 'select': {
        if (!(el instanceof HTMLSelectElement)) return { ok: false, error: 'Target is not a <select>' };
        const needle = normalize(cmd.value ?? cmd.textValue ?? cmd.option ?? '');
        let option = Array.from(el.options).find((o) => normalize(o.value) === needle || normalize(o.textContent) === needle);
        if (!option) option = Array.from(el.options).find((o) => normalize(o.textContent).includes(needle));
        if (!option) return { ok: false, error: 'Option not found' };
        el.value = option.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, element: elementInfo(el), selected: option.textContent?.trim() };
      }
      case 'read':
      case 'gettext':
        return { ok: true, element: elementInfo(el), text: (el.innerText || el.textContent || '').trim(), value: 'value' in el ? el.value : null };
      case 'value':
        return { ok: true, element: elementInfo(el), value: 'value' in el ? el.value : null };
      case 'highlight': {
        const old = el.style.outline;
        const oldOffset = el.style.outlineOffset;
        el.style.outline = '3px solid #ff8a00';
        el.style.outlineOffset = '3px';
        setTimeout(() => { el.style.outline = old; el.style.outlineOffset = oldOffset; }, Number(cmd.ms || 1500));
        return { ok: true, element: elementInfo(el) };
      }
      case 'submit': {
        const form = el instanceof HTMLFormElement ? el : el.closest('form');
        if (!form) return { ok: false, error: 'No containing form found' };
        if (typeof form.requestSubmit === 'function') form.requestSubmit(); else form.submit();
        return { ok: true };
      }
      case 'key':
      case 'press': {
        const key = String(cmd.key || cmd.value || 'Enter');
        el.focus?.();
        keyboardEvent('keydown', key, cmd);
        keyboardEvent('keyup', key, cmd);
        return { ok: true, key, element: elementInfo(el) };
      }
      default:
        return { ok: false, error: `Unsupported page action: ${action}` };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.channel !== '986code-page') return;
    Promise.resolve(run(message.command)).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });
})();

const defaultBase = window.location.origin;

const apiBaseInput = document.getElementById('apiBase');
const apiBaseDisplay = document.getElementById('apiBaseDisplay');
const saveBaseBtn = document.getElementById('saveBaseBtn');
const loginBtn = document.getElementById('loginBtn');
const sendBtn = document.getElementById('sendBtn');
const qrImageBtn = document.getElementById('qrImageBtn');
const qrTextBtn = document.getElementById('qrTextBtn');
const qrHtmlBtn = document.getElementById('qrHtmlBtn');

const tokenField = document.getElementById('token');
const qrTextEl = document.getElementById('qrText');
const qrImageEl = document.getElementById('qrImage');
const qrHtmlEl = document.getElementById('qrHtml');
const sendResult = document.getElementById('sendResult');
const ruleSearch = document.getElementById('ruleSearch');
const newMatch = document.getElementById('newMatch');
const newReply = document.getElementById('newReply');
const addRuleBtn = document.getElementById('addRuleBtn');
const refreshRulesBtn = document.getElementById('refreshRulesBtn');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
const rulesTable = document.getElementById('rulesTable');
const rulesStatus = document.getElementById('rulesStatus');
const clearSearchBtn = document.getElementById('clearSearchBtn');

let rulesState = [];
let rulesError = '';

function setRulesStatus(message) {
  rulesStatus.textContent = message || '';
}

function getApiBase() {
  return localStorage.getItem('bowas_api_base') || defaultBase;
}

function setApiBase(value) {
  const trimmed = value.trim();
  if (!trimmed) return;
  localStorage.setItem('bowas_api_base', trimmed);
  renderApiBase();
}

function getToken() {
  return tokenField.value.trim();
}

function requireToken() {
  const token = getToken();
  if (!token) {
    setRulesStatus('Login required to modify rules.');
    return null;
  }
  return token;
}

function renderApiBase() {
  const value = getApiBase();
  apiBaseInput.value = value;
  apiBaseDisplay.textContent = value;
}

async function apiRequest(path, options = {}) {
  const base = getApiBase();
  const baseUrl = base.endsWith('/') ? base.slice(0, -1) : base;
  const url = `${baseUrl}/api${path}`;
  const headers = options.headers || {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    const html = await response.text();
    return { ok: response.ok, status: response.status, html };
  }
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

function showQrState({ text = '', image = '', html = '' }) {
  qrTextEl.textContent = text;
  qrImageEl.src = image || '';
  qrImageEl.classList.toggle('hidden', !image);
  if (html) {
    const doc = qrHtmlEl.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
    }
    qrHtmlEl.classList.remove('hidden');
  } else {
    qrHtmlEl.classList.add('hidden');
  }
}

function fuzzyMatch(needle, haystack) {
  if (!needle) return true;
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  let i = 0;
  for (const ch of h) {
    if (ch === n[i]) i += 1;
    if (i === n.length) return true;
  }
  return false;
}

function renderRules() {
  const query = (ruleSearch.value || '').trim().toLowerCase();
  const filtered = query
    ? rulesState.filter((rule) => {
        const combined = `${rule.match} ${rule.reply}`;
        return fuzzyMatch(query, combined);
      })
    : rulesState.slice();

  rulesTable.innerHTML = '';
  if (filtered.length === 0) {
    const row = document.createElement('tr');
    let message = rulesError ? rulesError : 'No rules found.';
    if (!rulesError && query) {
      message = 'No rules match your search.';
    }
    row.innerHTML = `<td class="px-3 py-3 text-slate-400" colspan="4">${message}</td>`;
    rulesTable.appendChild(row);
    return;
  }

  for (const rule of filtered) {
    const row = document.createElement('tr');
    row.className = 'border-t border-slate-800';
    row.innerHTML = `
      <td class="px-3 py-2">
        <input type="checkbox" class="rule-select" data-match="${rule.match}" />
      </td>
      <td class="px-3 py-2">
        <input class="rule-match w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1" value="${rule.match}" data-original="${rule.match}" />
      </td>
      <td class="px-3 py-2">
        <input class="rule-reply w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1" value="${rule.reply}" />
      </td>
      <td class="px-3 py-2">
        <button class="rule-save rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold text-slate-950">Save</button>
      </td>
    `;

    const saveBtn = row.querySelector('.rule-save');
    saveBtn.addEventListener('click', async () => {
      if (!requireToken()) return;
      const matchInput = row.querySelector('.rule-match');
      const replyInput = row.querySelector('.rule-reply');
      const match = matchInput.value.trim();
      const reply = replyInput.value.trim();
      const original = matchInput.dataset.original || '';
      setRulesStatus('');

      if (!match || !reply) {
        setRulesStatus('Match and reply are required.');
        return;
      }

      if (original && original !== match) {
        await apiRequest(`/autoreply/rules?match=${encodeURIComponent(original)}`, {
          method: 'DELETE',
        });
      }
      const result = await apiRequest('/autoreply/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match, reply }),
      });

      if (result.ok) {
        await loadRules();
        setRulesStatus('Saved.');
        return;
      }

      setRulesStatus(result.data?.error || `Error (${result.status})`);
    });

    rulesTable.appendChild(row);
  }
}

async function loadRules() {
  const result = await apiRequest('/autoreply/rules');
  if (result.ok && result.data?.rules) {
    rulesState = result.data.rules;
    rulesError = '';
    setRulesStatus(`Loaded ${rulesState.length} rules.`);
  } else {
    rulesState = [];
    rulesError = result.data?.error || `Failed to load rules (${result.status})`;
    setRulesStatus(rulesError);
  }
  renderRules();
}

loginBtn.addEventListener('click', async () => {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  const result = await apiRequest('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (result.ok && result.data?.token) {
    tokenField.value = result.data.token;
  } else {
    tokenField.value = result.data?.error || `Login failed (${result.status})`;
  }
});

sendBtn.addEventListener('click', async () => {
  const to = document.getElementById('to').value.trim();
  const message = document.getElementById('message').value.trim();
  const result = await apiRequest('/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, message }),
  });

  sendResult.textContent = JSON.stringify(result.data || { status: result.status }, null, 2);
});

qrImageBtn.addEventListener('click', async () => {
  const result = await apiRequest('/whatsapp/auth');
  if (result.ok && result.data?.qrImageDataUrl) {
    showQrState({ image: result.data.qrImageDataUrl, text: '' });
  } else {
    showQrState({ text: result.data?.error || `Error (${result.status})` });
  }
});

qrTextBtn.addEventListener('click', async () => {
  const result = await apiRequest('/whatsapp/auth?text=true');
  if (result.ok && result.data?.qr) {
    showQrState({ text: result.data.qr, image: '' });
  } else {
    showQrState({ text: result.data?.error || `Error (${result.status})` });
  }
});

qrHtmlBtn.addEventListener('click', async () => {
  const result = await apiRequest('/whatsapp/auth?html=true');
  if (result.ok && result.html) {
    showQrState({ html: result.html, text: '' });
  } else {
    showQrState({ text: result.data?.error || `Error (${result.status})` });
  }
});

saveBaseBtn.addEventListener('click', () => {
  setApiBase(apiBaseInput.value);
});

addRuleBtn.addEventListener('click', async () => {
  if (!requireToken()) return;
  const match = newMatch.value.trim();
  const reply = newReply.value.trim();
  setRulesStatus('');
  if (!match || !reply) {
    setRulesStatus('Match and reply are required.');
    return;
  }
  const result = await apiRequest('/autoreply/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ match, reply }),
  });

  if (result.ok) {
    newMatch.value = '';
    newReply.value = '';
    ruleSearch.value = '';
    await loadRules();
    setRulesStatus('Saved.');
    return;
  }

  setRulesStatus(result.data?.error || `Error (${result.status})`);
});

deleteSelectedBtn.addEventListener('click', async () => {
  if (!requireToken()) return;
  const selected = Array.from(document.querySelectorAll('.rule-select:checked')).map((el) => el.dataset.match);
  if (selected.length === 0) return;

  setRulesStatus('');

  for (const match of selected) {
    await apiRequest(`/autoreply/rules?match=${encodeURIComponent(match)}`, {
      method: 'DELETE',
    });
  }

  await loadRules();
  setRulesStatus('Deleted.');
});

refreshRulesBtn.addEventListener('click', () => {
  loadRules();
});

ruleSearch.addEventListener('input', () => {
  renderRules();
});

clearSearchBtn.addEventListener('click', () => {
  ruleSearch.value = '';
  renderRules();
});

renderApiBase();
showQrState({ text: 'QR output will appear here.' });
loadRules();

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

renderApiBase();
showQrState({ text: 'QR output will appear here.' });

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createApiHandler, createJwtService } = require('../../src/api');

function invoke(handler, { method, url, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    req.headers = headers;
    req.socket = { destroy() {} };

    const response = {
      status: 200,
      headers: {},
      body: '',
      writeHead(statusCode, hdrs) {
        this.status = statusCode;
        this.headers = { ...this.headers, ...(hdrs || {}) };
      },
      end(payload = '') {
        this.body = payload;
        let parsed = null;
        try {
          parsed = payload ? JSON.parse(payload) : null;
        } catch {
          parsed = null;
        }
        resolve({ status: this.status, headers: this.headers, body: parsed, raw: payload });
      },
    };

    Promise.resolve(handler(req, response)).catch(reject);

    process.nextTick(() => {
      if (typeof body !== 'undefined') {
        req.emit('data', JSON.stringify(body));
      }
      req.emit('end');
    });
  });
}

test('login and send flow with jwt auth', async () => {
  const sentMessages = [];
  let ready = true;
  let deauthCalled = false;
  const jwtService = createJwtService({
    jwtSecret: 'integration-secret',
    jwtIssuer: 'bowas',
    jwtAudience: 'clients',
  });

  const handler = createApiHandler({
    getIsClientReady: () => ready,
    sendMessage: async (to, message) => {
      sentMessages.push({ to, message });
      return { id: { _serialized: 'msg-1' } };
    },
    authUsername: 'botuser',
    authPassword: 'botpass',
    jwtTtlSeconds: 3600,
    jwtIssuer: 'bowas',
    jwtAudience: 'clients',
    jwtService,
    deauthClient: async () => {
      deauthCalled = true;
    },
    requestAuthQr: async ({ text }) => {
      if (text) {
        return {
          mode: 'text',
          qr: 'ASCII_QR',
          generatedAt: '2026-02-25T00:00:00.000Z',
        };
      }

      return {
        mode: 'image',
        qrImageDataUrl: 'data:image/png;base64,AAAA',
        generatedAt: '2026-02-25T00:00:00.000Z',
      };
    },
  });

  const badLogin = await invoke(handler, {
    method: 'POST',
    url: '/login',
    body: { username: 'x', password: 'y' },
  });
  assert.equal(badLogin.status, 401);

  const login = await invoke(handler, {
    method: 'POST',
    url: '/login',
    body: { username: 'botuser', password: 'botpass' },
  });
  assert.equal(login.status, 200);
  assert.equal(typeof login.body.token, 'string');

  const noAuth = await invoke(handler, {
    method: 'POST',
    url: '/send',
    body: { to: '6281234567890', message: 'hello' },
  });
  assert.equal(noAuth.status, 401);

  const send = await invoke(handler, {
    method: 'POST',
    url: '/send',
    headers: { authorization: `Bearer ${login.body.token}` },
    body: { to: '6281234567890', message: 'hello' },
  });
  assert.equal(send.status, 200);
  assert.equal(send.body.ok, true);
  assert.equal(sentMessages.length, 1);
  assert.deepEqual(sentMessages[0], { to: '6281234567890@c.us', message: 'hello' });

  const authQrImage = await invoke(handler, {
    method: 'POST',
    url: '/whatsapp/auth',
    headers: { authorization: `Bearer ${login.body.token}` },
  });
  assert.equal(authQrImage.status, 200);
  assert.equal(authQrImage.body.mode, 'image');
  assert.equal(typeof authQrImage.body.qrImageDataUrl, 'string');

  const authQrText = await invoke(handler, {
    method: 'POST',
    url: '/whatsapp/auth?text=true',
    headers: { authorization: `Bearer ${login.body.token}` },
  });
  assert.equal(authQrText.status, 200);
  assert.equal(authQrText.body.mode, 'text');
  assert.equal(authQrText.body.qr, 'ASCII_QR');

  const authQrHtml = await invoke(handler, {
    method: 'POST',
    url: '/whatsapp/auth?html=true',
    headers: { authorization: `Bearer ${login.body.token}` },
  });
  assert.equal(authQrHtml.status, 200);
  assert.equal(authQrHtml.body, null);
  assert.match(authQrHtml.headers['Content-Type'] || authQrHtml.headers['content-type'], /text\/html/i);
  assert.match(authQrHtml.raw, /<img src="data:image\/png;base64,AAAA"/);

  const deauth = await invoke(handler, {
    method: 'POST',
    url: '/whatsapp/deauth',
    headers: { authorization: `Bearer ${login.body.token}` },
    body: {},
  });
  assert.equal(deauth.status, 200);
  assert.equal(deauth.body.ok, true);
  assert.equal(deauthCalled, true);

  ready = false;
  const notReady = await invoke(handler, {
    method: 'POST',
    url: '/send',
    headers: { authorization: `Bearer ${login.body.token}` },
    body: { to: '6281234567890', message: 'hello' },
  });
  assert.equal(notReady.status, 503);
});

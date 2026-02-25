const http = require('http');
const crypto = require('crypto');

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function decodeBase64UrlToJson(value) {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    return JSON.parse(Buffer.from(normalized + padding, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function createJwtService(config) {
  const jwtSecret = config.jwtSecret;
  const jwtIssuer = config.jwtIssuer || '';
  const jwtAudience = config.jwtAudience || '';

  function signJwt(payload) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = crypto.createHmac('sha256', jwtSecret).update(signingInput).digest('base64url');
    return `${signingInput}.${signature}`;
  }

  function verifyJwt(token) {
    if (!token || typeof token !== 'string') {
      return { ok: false, reason: 'Missing token' };
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      return { ok: false, reason: 'Malformed token' };
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodeBase64UrlToJson(encodedHeader);
    const payload = decodeBase64UrlToJson(encodedPayload);
    if (!header || !payload) {
      return { ok: false, reason: 'Invalid token encoding' };
    }

    if (header.alg !== 'HS256') {
      return { ok: false, reason: 'Unsupported JWT alg (expected HS256)' };
    }

    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = crypto
      .createHmac('sha256', jwtSecret)
      .update(signingInput)
      .digest('base64url');

    const sigA = Buffer.from(encodedSignature);
    const sigB = Buffer.from(expectedSignature);
    if (sigA.length !== sigB.length || !crypto.timingSafeEqual(sigA, sigB)) {
      return { ok: false, reason: 'Invalid signature' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.nbf === 'number' && now < payload.nbf) {
      return { ok: false, reason: 'Token not active yet (nbf)' };
    }
    if (typeof payload.exp === 'number' && now >= payload.exp) {
      return { ok: false, reason: 'Token expired (exp)' };
    }
    if (jwtIssuer && payload.iss !== jwtIssuer) {
      return { ok: false, reason: 'Invalid issuer (iss)' };
    }
    if (jwtAudience && payload.aud !== jwtAudience) {
      return { ok: false, reason: 'Invalid audience (aud)' };
    }

    return { ok: true, payload };
  }

  function authenticateRequest(req) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return { ok: false, reason: 'Missing Bearer token' };
    }
    const token = header.slice('Bearer '.length).trim();
    return verifyJwt(token);
  }

  return {
    signJwt,
    verifyJwt,
    authenticateRequest,
  };
}

function normalizeChatId(to) {
  if (typeof to !== 'string') return null;
  const trimmed = to.trim();
  if (!trimmed) return null;

  if (trimmed.endsWith('@c.us') || trimmed.endsWith('@g.us')) {
    return trimmed;
  }

  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  return `${digits}@c.us`;
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let rawBody = '';
    req.on('data', (chunk) => {
      rawBody += chunk;
      if (rawBody.length > maxBytes) {
        req.socket.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(rawBody ? JSON.parse(rawBody) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function createApiHandler(config) {
  const {
    getIsClientReady,
    sendMessage,
    authUsername,
    authPassword,
    jwtTtlSeconds,
    jwtService,
    deauthClient,
    requestAuthQr,
  } = config;

  return async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, {
        status: 'ok',
        whatsappReady: getIsClientReady(),
      });
    }

    if (req.method === 'POST' && req.url === '/login') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body' });
      }

      const username = typeof body.username === 'string' ? body.username : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (username !== authUsername || password !== authPassword) {
        return sendJson(res, 401, { error: 'Invalid username or password' });
      }

      const now = Math.floor(Date.now() / 1000);
      const payload = {
        sub: username,
        iat: now,
        nbf: now,
        exp: now + jwtTtlSeconds,
      };
      if (config.jwtIssuer) payload.iss = config.jwtIssuer;
      if (config.jwtAudience) payload.aud = config.jwtAudience;

      const token = jwtService.signJwt(payload);
      return sendJson(res, 200, {
        token,
        tokenType: 'Bearer',
        expiresIn: jwtTtlSeconds,
      });
    }

    if (req.method === 'POST' && req.url === '/send') {
      const auth = jwtService.authenticateRequest(req);
      if (!auth.ok) {
        return sendJson(
          res,
          401,
          { error: `Unauthorized: ${auth.reason}` },
          { 'WWW-Authenticate': 'Bearer' }
        );
      }

      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body' });
      }

      const chatId = normalizeChatId(body.to);
      const text = typeof body.message === 'string' ? body.message.trim() : '';

      if (!chatId || !text) {
        return sendJson(res, 400, { error: 'Required fields: to, message' });
      }

      if (!getIsClientReady()) {
        return sendJson(res, 503, { error: 'WhatsApp client is not ready yet' });
      }

      try {
        const sent = await sendMessage(chatId, text);
        return sendJson(res, 200, {
          ok: true,
          to: chatId,
          id: sent?.id?._serialized || null,
        });
      } catch (err) {
        return sendJson(res, 500, {
          error: err?.message || 'Failed to send message',
        });
      }
    }

    if (req.method === 'POST' && req.url === '/whatsapp/deauth') {
      const auth = jwtService.authenticateRequest(req);
      if (!auth.ok) {
        return sendJson(
          res,
          401,
          { error: `Unauthorized: ${auth.reason}` },
          { 'WWW-Authenticate': 'Bearer' }
        );
      }

      if (typeof deauthClient !== 'function') {
        return sendJson(res, 500, { error: 'Deauth is not configured' });
      }

      try {
        await deauthClient();
        return sendJson(res, 200, {
          ok: true,
          message: 'WhatsApp client deauthenticated. A new QR will be generated shortly.',
        });
      } catch (err) {
        return sendJson(res, 500, {
          error: err?.message || 'Failed to deauthenticate client',
        });
      }
    }

    if (req.method === 'POST' && req.url === '/whatsapp/auth') {
      const auth = jwtService.authenticateRequest(req);
      if (!auth.ok) {
        return sendJson(
          res,
          401,
          { error: `Unauthorized: ${auth.reason}` },
          { 'WWW-Authenticate': 'Bearer' }
        );
      }

      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body' });
      }

      if (typeof requestAuthQr !== 'function') {
        return sendJson(res, 500, { error: 'Auth QR request is not configured' });
      }

      try {
        const result = await requestAuthQr({ text: body.text === true });
        return sendJson(res, 200, result);
      } catch (err) {
        const message = err?.message || 'Failed to get auth QR';
        const statusCode = message.includes('already authenticated') ? 409 : 503;
        return sendJson(res, statusCode, { error: message });
      }
    }

    return sendJson(res, 404, { error: 'Not found' });
  };
}

function createApiServer(config) {
  const port = config.port;
  const host = config.host || '0.0.0.0';
  const handler = createApiHandler(config);
  const server = http.createServer(handler);

  server.listen(port, host, () => {
    console.log(`REST API listening on http://${host}:${port}`);
  });

  return server;
}

module.exports = {
  createJwtService,
  createApiHandler,
  createApiServer,
  normalizeChatId,
};

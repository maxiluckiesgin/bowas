const http = require('http');
const crypto = require('crypto');

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, statusCode, html, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    ...extraHeaders,
  });
  res.end(html);
}

function isTruthyQueryParam(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
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
    corsOrigin,
    getAutoReplyRules,
    addAutoReplyRule,
    removeAutoReplyRule,
  } = config;

  const corsHeaders = {
    'Access-Control-Allow-Origin': corsOrigin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  return async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      return res.end();
    }

    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = requestUrl.pathname;

    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(
        res,
        200,
        {
        status: 'ok',
        whatsappReady: getIsClientReady(),
        },
        corsHeaders
      );
    }

    if (req.method === 'POST' && pathname === '/login') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body' }, corsHeaders);
      }

      const username = typeof body.username === 'string' ? body.username : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (username !== authUsername || password !== authPassword) {
        return sendJson(res, 401, { error: 'Invalid username or password' }, corsHeaders);
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
      return sendJson(
        res,
        200,
        {
        token,
        tokenType: 'Bearer',
        expiresIn: jwtTtlSeconds,
        },
        corsHeaders
      );
    }

    if (req.method === 'POST' && pathname === '/send') {
      const auth = jwtService.authenticateRequest(req);
      if (!auth.ok) {
        return sendJson(
          res,
          401,
          { error: `Unauthorized: ${auth.reason}` },
          { ...corsHeaders, 'WWW-Authenticate': 'Bearer' }
        );
      }

      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body' }, corsHeaders);
      }

      const chatId = normalizeChatId(body.to);
      const text = typeof body.message === 'string' ? body.message.trim() : '';

      if (!chatId || !text) {
        return sendJson(res, 400, { error: 'Required fields: to, message' }, corsHeaders);
      }

      if (!getIsClientReady()) {
        return sendJson(res, 503, { error: 'WhatsApp client is not ready yet' }, corsHeaders);
      }

      try {
        const sent = await sendMessage(chatId, text);
        return sendJson(
          res,
          200,
          {
          ok: true,
          to: chatId,
          id: sent?.id?._serialized || null,
          },
          corsHeaders
        );
      } catch (err) {
        return sendJson(res, 500, {
          error: err?.message || 'Failed to send message',
        }, corsHeaders);
      }
    }

    if (req.method === 'POST' && pathname === '/whatsapp/deauth') {
      const auth = jwtService.authenticateRequest(req);
      if (!auth.ok) {
        return sendJson(
          res,
          401,
          { error: `Unauthorized: ${auth.reason}` },
          { ...corsHeaders, 'WWW-Authenticate': 'Bearer' }
        );
      }

      if (typeof deauthClient !== 'function') {
        return sendJson(res, 500, { error: 'Deauth is not configured' }, corsHeaders);
      }

      try {
        await deauthClient();
        return sendJson(
          res,
          200,
          {
          ok: true,
          message: 'WhatsApp client deauthenticated. A new QR will be generated shortly.',
          },
          corsHeaders
        );
      } catch (err) {
        return sendJson(res, 500, {
          error: err?.message || 'Failed to deauthenticate client',
        }, corsHeaders);
      }
    }

    if (req.method === 'POST' && pathname === '/whatsapp/auth') {
      const auth = jwtService.authenticateRequest(req);
      if (!auth.ok) {
        return sendJson(
          res,
          401,
          { error: `Unauthorized: ${auth.reason}` },
          { ...corsHeaders, 'WWW-Authenticate': 'Bearer' }
        );
      }

      if (typeof requestAuthQr !== 'function') {
        return sendJson(res, 500, { error: 'Auth QR request is not configured' }, corsHeaders);
      }

      const text = isTruthyQueryParam(requestUrl.searchParams.get('text'));
      const html = isTruthyQueryParam(requestUrl.searchParams.get('html'));

      try {
        const result = await requestAuthQr({ text });

        if (html) {
          const qrImageDataUrl = result?.qrImageDataUrl;
          if (typeof qrImageDataUrl !== 'string' || !qrImageDataUrl.startsWith('data:image/')) {
            return sendJson(res, 400, {
              error: 'HTML mode requires image QR. Use html=true without text=true',
            }, corsHeaders);
          }

          const generatedAt = result.generatedAt ? String(result.generatedAt) : '';
          const generatedAtHtml = generatedAt
            ? `<p><strong>Generated at:</strong> ${generatedAt}</p>`
            : '';
          const htmlPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>WhatsApp Auth QR</title>
  </head>
  <body>
    <h1>WhatsApp Auth QR</h1>
    ${generatedAtHtml}
    <img src="${qrImageDataUrl}" alt="WhatsApp Auth QR" />
  </body>
</html>`;

          return sendHtml(res, 200, htmlPage);
        }

        return sendJson(res, 200, result, corsHeaders);
      } catch (err) {
        const message = err?.message || 'Failed to get auth QR';
        const statusCode = message.includes('already authenticated') ? 409 : 503;
        return sendJson(res, statusCode, { error: message }, corsHeaders);
      }
    }

    if (req.method === 'GET' && pathname === '/autoreply/rules') {
      if (typeof getAutoReplyRules !== 'function') {
        return sendJson(res, 500, { error: 'Auto-reply is not configured' }, corsHeaders);
      }

      return sendJson(res, 200, { rules: getAutoReplyRules() }, corsHeaders);
    }

    if (req.method === 'POST' && pathname === '/autoreply/rules') {
      const auth = jwtService.authenticateRequest(req);
      if (!auth.ok) {
        return sendJson(
          res,
          401,
          { error: `Unauthorized: ${auth.reason}` },
          { ...corsHeaders, 'WWW-Authenticate': 'Bearer' }
        );
      }

      if (typeof addAutoReplyRule !== 'function') {
        return sendJson(res, 500, { error: 'Auto-reply is not configured' }, corsHeaders);
      }

      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body' }, corsHeaders);
      }

      const match = typeof body.match === 'string' ? body.match.trim() : '';
      const reply = typeof body.reply === 'string' ? body.reply.trim() : '';
      if (!match || !reply) {
        return sendJson(res, 400, { error: 'Required fields: match, reply' }, corsHeaders);
      }

      const rule = addAutoReplyRule({ match, reply });
      return sendJson(res, 200, { rule }, corsHeaders);
    }

    if (req.method === 'DELETE' && pathname === '/autoreply/rules') {
      const auth = jwtService.authenticateRequest(req);
      if (!auth.ok) {
        return sendJson(
          res,
          401,
          { error: `Unauthorized: ${auth.reason}` },
          { ...corsHeaders, 'WWW-Authenticate': 'Bearer' }
        );
      }

      if (typeof removeAutoReplyRule !== 'function') {
        return sendJson(res, 500, { error: 'Auto-reply is not configured' }, corsHeaders);
      }

      const match = requestUrl.searchParams.get('match') || '';
      if (!match.trim()) {
        return sendJson(res, 400, { error: 'Query param required: match' }, corsHeaders);
      }

      const removed = removeAutoReplyRule(match);
      if (!removed) {
        return sendJson(res, 404, { error: 'Rule not found' }, corsHeaders);
      }

      return sendJson(res, 200, { ok: true }, corsHeaders);
    }

    return sendJson(res, 404, { error: 'Not found' }, corsHeaders);
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

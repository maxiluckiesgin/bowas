const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { createApiServer, createJwtService } = require('./src/api');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-change-me';
const JWT_ISSUER = process.env.JWT_ISSUER || '';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || '';
const AUTH_USERNAME = process.env.AUTH_USERNAME || 'admin';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'admin';
const JWT_TTL_SECONDS = Number(process.env.JWT_TTL_SECONDS || 3600);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const AUTOREPLY_DB_PATH = process.env.AUTOREPLY_DB_PATH || './data/autoreply.db';
let isClientReady = false;
let latestQr = null;
let latestQrAt = null;
let autoReplyRules = [
  { match: 'hello', reply: 'world' },
];

function ensureDbDirectory(dbPath) {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
}

function createAutoReplyStore(dbPath) {
  ensureDbDirectory(dbPath);
  const db = new sqlite3.Database(dbPath);

  db.serialize(() => {
    db.run('PRAGMA journal_mode = WAL');
    db.run(
      'CREATE TABLE IF NOT EXISTS autoreply_rules (match TEXT PRIMARY KEY, reply TEXT NOT NULL)'
    );
  });

  function loadRules(callback) {
    db.get('SELECT COUNT(*) as count FROM autoreply_rules', (err, row) => {
      if (err) {
        return callback(err);
      }
      if ((row?.count || 0) === 0) {
        db.run(
          'INSERT INTO autoreply_rules(match, reply) VALUES(?, ?)',
          ['hello', 'world'],
          (seedErr) => {
            if (seedErr) return callback(seedErr);
            db.all('SELECT match, reply FROM autoreply_rules', callback);
          }
        );
      } else {
        db.all('SELECT match, reply FROM autoreply_rules', callback);
      }
    });
  }

  function listRules() {
    return autoReplyRules.slice();
  }

  function upsertRule(match, reply, callback) {
    db.run(
      'INSERT INTO autoreply_rules(match, reply) VALUES(?, ?) ON CONFLICT(match) DO UPDATE SET reply=excluded.reply',
      [match, reply],
      callback
    );
  }

  function deleteRule(match, callback) {
    db.run('DELETE FROM autoreply_rules WHERE match = ?', [match], function (err) {
      if (err) return callback(err);
      callback(null, this.changes > 0);
    });
  }

  return { db, loadRules, listRules, upsertRule, deleteRule };
}

const autoReplyStore = createAutoReplyStore(AUTOREPLY_DB_PATH);
autoReplyStore.loadRules((err, rows) => {
  if (err) {
    console.error('Failed to load auto-reply rules:', err);
    return;
  }
  autoReplyRules = (rows || []).map((row) => ({ match: row.match, reply: row.reply }));
});

if (JWT_SECRET === 'dev-insecure-change-me') {
  console.warn('JWT_SECRET is using default insecure value. Set JWT_SECRET in production.');
}
if (AUTH_USERNAME === 'admin' && AUTH_PASSWORD === 'admin') {
  console.warn('AUTH_USERNAME/AUTH_PASSWORD are using default insecure values.');
}

const jwtService = createJwtService({
  jwtSecret: JWT_SECRET,
  jwtIssuer: JWT_ISSUER,
  jwtAudience: JWT_AUDIENCE,
});

const authOptions = {
  dataPath: process.env.WWEBJS_AUTH_PATH || './.wwebjs_auth',
};

if (process.env.WWEBJS_CLIENT_ID) {
  authOptions.clientId = process.env.WWEBJS_CLIENT_ID;
}

const client = new Client({
  authStrategy: new LocalAuth(authOptions),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    headless: process.env.PUPPETEER_HEADLESS !== 'false',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  },
});

client.on('qr', (qr) => {
  latestQr = qr;
  latestQrAt = new Date().toISOString();
  console.log('WhatsApp QR generated. Fetch it via POST /whatsapp/auth');
});

client.on('ready', () => {
  isClientReady = true;
  latestQr = null;
  latestQrAt = null;
  console.log('Client is ready!');
});

client.on('authenticated', () => {
  console.log('Client is authenticated!');
});

client.on('disconnected', (reason) => {
  isClientReady = false;
  console.log('Client disconnected:', reason);
});

client.on('auth_failure', (message) => {
  isClientReady = false;
  console.error('Authentication failure:', message);
});

client.on('message', async (message) => {
  if (message.fromMe) return;

  if (message.isGroupMsg || (message.from || '').endsWith('@g.us')) {
    return;
  }

  const text = (message.body || '').trim().toLowerCase();

  const rule = autoReplyRules.find((item) => item.match === text);
  if (!rule) return;

  try {
    await message.reply(rule.reply);
    console.log(`Auto-replied to ${message.from} with "${rule.reply}"`);
  } catch (err) {
    console.error('Failed to send auto-reply:', err);
  }
});

createApiServer({
  port: PORT,
  host: HOST,
  getIsClientReady: () => isClientReady,
  sendMessage: (to, message) => client.sendMessage(to, message),
  authUsername: AUTH_USERNAME,
  authPassword: AUTH_PASSWORD,
  jwtTtlSeconds: JWT_TTL_SECONDS,
  jwtIssuer: JWT_ISSUER,
  jwtAudience: JWT_AUDIENCE,
  jwtService,
  corsOrigin: CORS_ORIGIN,
  deauthClient: async () => {
    try {
      await client.logout();
    } catch {
      // ignore logout errors when already unauthenticated/disconnected
    }

    isClientReady = false;
    latestQr = null;
    latestQrAt = null;
    await client.initialize();

    return { ok: true };
  },
  requestAuthQr: async ({ text }) => {
    if (isClientReady) {
      throw new Error('WhatsApp client is already authenticated');
    }

    if (!latestQr) {
      throw new Error('QR is not available yet. Please retry in a few seconds');
    }

    if (text) {
      const asciiQr = await QRCode.toString(latestQr, {
        type: 'terminal',
        small: true,
      });

      return {
        mode: 'text',
        qr: asciiQr,
        generatedAt: latestQrAt,
      };
    }

    return {
      mode: 'image',
      qrImageDataUrl: await QRCode.toDataURL(latestQr, {
        width: 300,
        margin: 1,
      }),
      generatedAt: latestQrAt,
    };
  },
  getAutoReplyRules: () => autoReplyRules.slice(),
  addAutoReplyRule: ({ match, reply }) => {
    const normalizedMatch = match.trim().toLowerCase();
    const normalizedReply = reply.trim();
    const next = { match: normalizedMatch, reply: normalizedReply };

    return new Promise((resolve, reject) => {
      autoReplyStore.upsertRule(normalizedMatch, normalizedReply, (err) => {
        if (err) {
          return reject(err);
        }
        autoReplyRules = autoReplyRules.filter((rule) => rule.match !== normalizedMatch);
        autoReplyRules.push(next);
        resolve(next);
      });
    });
  },
  removeAutoReplyRule: (match) => {
    const normalizedMatch = match.trim().toLowerCase();
    return new Promise((resolve, reject) => {
      autoReplyStore.deleteRule(normalizedMatch, (err, ok) => {
        if (err) {
          return reject(err);
        }
        if (ok) {
          autoReplyRules = autoReplyRules.filter((rule) => rule.match !== normalizedMatch);
        }
        resolve(ok);
      });
    });
  },
});

client.initialize();

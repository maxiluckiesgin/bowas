const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
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
let isClientReady = false;
let latestQr = null;
let latestQrAt = null;

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
  qrcode.generate(qr, { small: true });
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

  const text = (message.body || '').trim().toLowerCase();

  if (text.includes('hello')) {
    try {
      await message.reply('world');
      console.log(`Replied to ${message.from} with "world"`);
    } catch (err) {
      console.error('Failed to send reply:', err);
    }
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
      const asciiQr = await new Promise((resolve) => {
        qrcode.generate(latestQr, { small: true }, (qrText) => resolve(qrText));
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
});

client.initialize();

const crypto = require('crypto');

const secret = process.env.JWT_SECRET;
if (!secret) {
  console.error('JWT_SECRET is required');
  process.exit(1);
}

const sub = process.argv[2] || 'bowas-client';
const ttl = Number(process.argv[3] || 3600);
const now = Math.floor(Date.now() / 1000);

const header = { alg: 'HS256', typ: 'JWT' };
const payload = {
  sub,
  iat: now,
  nbf: now,
  exp: now + ttl,
};

if (process.env.JWT_ISSUER) payload.iss = process.env.JWT_ISSUER;
if (process.env.JWT_AUDIENCE) payload.aud = process.env.JWT_AUDIENCE;

const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const encodedHeader = encode(header);
const encodedPayload = encode(payload);
const signingInput = `${encodedHeader}.${encodedPayload}`;
const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');

console.log(`${signingInput}.${signature}`);

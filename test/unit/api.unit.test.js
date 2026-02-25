const test = require('node:test');
const assert = require('node:assert/strict');
const { createJwtService, normalizeChatId } = require('../../src/api');

test('normalizeChatId handles phone and explicit ids', () => {
  assert.equal(normalizeChatId('6281234567890'), '6281234567890@c.us');
  assert.equal(normalizeChatId('+62 812-3456-7890'), '6281234567890@c.us');
  assert.equal(normalizeChatId('12345@g.us'), '12345@g.us');
  assert.equal(normalizeChatId('12345@c.us'), '12345@c.us');
  assert.equal(normalizeChatId(''), null);
  assert.equal(normalizeChatId(null), null);
});

test('jwt sign and verify success path', () => {
  const jwt = createJwtService({
    jwtSecret: 'test-secret',
    jwtIssuer: 'bowas',
    jwtAudience: 'api-clients',
  });

  const now = Math.floor(Date.now() / 1000);
  const token = jwt.signJwt({
    sub: 'user1',
    iat: now,
    nbf: now,
    exp: now + 60,
    iss: 'bowas',
    aud: 'api-clients',
  });

  const result = jwt.verifyJwt(token);
  assert.equal(result.ok, true);
  assert.equal(result.payload.sub, 'user1');
});

test('jwt verify fails for bad signature', () => {
  const signer = createJwtService({ jwtSecret: 'secret-a' });
  const verifier = createJwtService({ jwtSecret: 'secret-b' });
  const now = Math.floor(Date.now() / 1000);
  const token = signer.signJwt({ sub: 'u', iat: now, nbf: now, exp: now + 60 });

  const result = verifier.verifyJwt(token);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Invalid signature/);
});

test('jwt verify fails when expired', () => {
  const jwt = createJwtService({ jwtSecret: 'secret' });
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.signJwt({ sub: 'u', iat: now - 120, nbf: now - 120, exp: now - 60 });

  const result = jwt.verifyJwt(token);
  assert.equal(result.ok, false);
  assert.match(result.reason, /expired/);
});

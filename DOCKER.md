# Docker usage

## Build

```bash
make docker-build
```

## Run

```bash
make docker-up
make docker-logs
```

On first run, scan the QR shown in logs.

REST API is exposed on `localhost:${HOST_PORT:-3000}`.

```bash
curl http://localhost:3000/health

TOKEN=$(curl -sS -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | node -e 'process.stdin.on("data",d=>{const o=JSON.parse(d);console.log(o.token||"");})')

curl -X POST http://localhost:3000/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"6281234567890","message":"hello from docker"}'
```

If port `3000` is already in use on your host, run with a different port:

```bash
HOST_PORT=3001 make docker-up
curl http://localhost:3001/health
```

## Stop

```bash
make docker-down
```

## Session persistence

Auth/session data is persisted on the host in:

- `.wwebjs_auth/`
- `.wwebjs_cache/`

Docker uses `WWEBJS_CLIENT_ID=docker`, so it keeps a separate session profile from local `node index.js` runs and avoids Chromium profile-lock conflicts.

`docker-compose.yml` also removes stale Chromium `Singleton*` lock files on startup before running `npm start`.

JWT settings used by the API:

- `JWT_SECRET` (required in production; default is insecure for local dev)
- `JWT_ISSUER` (optional)
- `JWT_AUDIENCE` (optional)
- `AUTH_USERNAME` (default `admin`)
- `AUTH_PASSWORD` (default `admin`)
- `JWT_TTL_SECONDS` (default `3600`)

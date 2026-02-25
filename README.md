# BOWAS

A minimal WhatsApp bot built with `whatsapp-web.js`.

## Current behavior

- If an incoming message contains `hello` (case-insensitive), the bot replies with `world`.
- Exposes a REST API:
  - `GET /health`
  - `POST /login` with JSON `{ "username": "...", "password": "..." }`
  - `POST /send` with JSON `{ "to": "...", "message": "..." }`
  - `POST /send` requires `Authorization: Bearer <jwt>`

## Requirements

- Node.js `>= 18` (project pinned to `.nvmrc`)
- `nvm` for local runs
- Docker + Docker Compose for containerized runs

## Local run (nvm)

```bash
cd /home/$USER/bowas
source ./projectrc
make start
```

On first run, scan the QR in terminal. Session is stored in `.wwebjs_auth/`.

Example REST calls (local):

```bash
curl http://localhost:3000/health

TOKEN=$(curl -sS -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | node -e 'process.stdin.on("data",d=>{const o=JSON.parse(d);console.log(o.token||"");})')

curl -X POST http://localhost:3000/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"6281234567890","message":"hello from api"}'
```

If port `3000` is occupied, use another host port when running Docker:

```bash
HOST_PORT=3001 make docker-up
curl http://localhost:3001/health
```

## Docker run

```bash
cd /home/$USER/bowas
make docker-up
make docker-logs
```

Stop:

```bash
make docker-down
```

Optional explicit build:

```bash
make docker-build
```


## Sync to personal BOWAS API

Add only missing endpoint files from the current OpenAPI spec into `/home/$USER/personal/BOWAS API/`:

```bash
make sync-personal-api TARGET_DIR="/home/$USER/personal/BOWAS API"
```

Direct script usage (optional custom paths):

```bash
python3 ./scripts/sync_personal_bowas_api.py --openapi-json ./openapi.json --target-dir "/home/$USER/personal/BOWAS API"
```

Behavior:

- Diff-only add: creates missing endpoint `.yml` files
- Does not overwrite existing collection files
- Prints added files or `No diff to add` when already in sync

## Project files

- `index.js`: bot logic and WhatsApp client bootstrap
- `src/api.js`: REST API handler and JWT/auth logic
- `openapi.yaml`: OpenAPI 3.0 specification
- `projectrc`: local shell setup (`nvm` + `nvm use`)
- `Makefile`: local and docker helper commands
- `docker-compose.yml`: runtime config and mounted session folders
- `Dockerfile`: image build (Node + Chromium for Puppeteer)

## Tests

```bash
npm test
```

Test suites:

- Unit tests: `test/unit/api.unit.test.js`
- Integration tests (in-process API handler): `test/integration/api.integration.test.js`

## Session persistence

- Local and Docker auth data are persisted under `.wwebjs_auth/`.
- Docker uses `WWEBJS_CLIENT_ID=docker` to avoid Chromium profile lock conflicts with local runs.
- Cache is stored in `.wwebjs_cache/`.

## Troubleshooting

- If QR keeps reappearing, your previous session may be invalid/expired; scan once again.
- If Docker logs show profile lock errors, ensure no local bot/chromium process is still using the same auth profile.
- If `/send` returns `503`, wait until logs show `Client is ready!`.
- If `/send` returns `401`, check your JWT token/signature/expiry.
- If `/login` returns `401`, check `AUTH_USERNAME` and `AUTH_PASSWORD`.

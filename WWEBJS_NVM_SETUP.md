# whatsapp-web.js Linux setup (nvm-based)

This adapts the official guide for an `nvm` workflow inside this project.

## 1) Load nvm and select project Node version

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install
nvm use
node -v
npm -v
```

`whatsapp-web.js` requires Node `v18+`.

## 2) (Optional) Install no-GUI Linux dependencies for Puppeteer/Chromium

Use this if you are on a headless server:

```bash
sudo apt update
sudo apt install -y gconf-service libgbm-dev libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget
```

## 3) Initialize project (already done here)

```bash
npm init -y
```

## 4) Install whatsapp-web.js

```bash
npm install whatsapp-web.js
```

## Notes for this workspace

- `.nvmrc` is pinned to `v22.19.0`.
- `package.json` includes `"engines": { "node": ">=18" }`.
- If npm cannot reach `registry.npmjs.org`, fix DNS/proxy/network first and rerun step 4.

## Source

- https://wwebjs.dev/guide/installation.html#installation-on-linux

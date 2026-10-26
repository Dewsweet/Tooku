<p align="center"><img src="../public/tooku.svg" width="30%" alt="Tooku"></p>

# Tooku

[简体中文](../README.md) · English

Tooku is a **third-party Navidrome web player**. It is a **personal project**, **built entirely with AI**!

*Tooku comes from the Japanese word「遠く」, meaning “far away.” For this project, it expresses the hope that good music can travel farther and last longer.*

## Features

- [x] **A decent-looking music player**
- [x] **Playlist management**: Create and edit playlists, reorder tracks by dragging, and organize playlists into folders.
- [x] **Online lyrics**: Local lyrics take priority, with NetEase / QQ lookup, bilingual display, version selection and timing offsets.
- [x] **AI recommendations**: Optionally connect Last.fm and AI services to generate music recommendations manually, with links to music platforms.
- [x] **PWA**: Install through your browser and open Tooku in a standalone app window.
- [x] **Accounts and personalization**: Light / dark modes, accent colors and custom images; account-based preferences, queues and history, with access across browsers, data export and restore.

## Screenshots

Main interface:

![Tooku main interface](pic/主界面.jpg)

Lyrics view:

![Tooku lyrics view](pic/歌词.jpg)

## Architecture

Tooku combines a React single-page application with a Node.js backend. One Node service provides both the website and APIs, with no separate database service required.

| Layer | Technology and responsibilities |
| --- | --- |
| Frontend | React, TypeScript, Vite and React Router |
| State and queries | TanStack Query for server data; Zustand for playback state and preferences |
| Backend | Node.js built-in HTTP and SQLite, providing sessions, account data, a Navidrome proxy, lyrics and recommendation APIs |
| Storage | SQLite for Tooku account data; IndexedDB and local storage for browser caches, snapshots and device preferences |
| Music service | Navidrome manages music files, library scans, favorites, server playlists and transcoding |

## Requirements

| Environment | Requirement |
| --- | --- |
| Docker | Docker Engine and Docker Compose for image deployment; the current image supports Linux AMD64 only |
| Node.js | Version 24.22.1 or later for running from source; not required on the host for Docker deployment |
| pnpm | Source installation uses the pinned version 11.25.0; run it through `npx` without a global installation |
| Git | Used to clone the source; image deployment only needs the Compose configuration |
| Navidrome | Already running and reachable from the Tooku service |
| Browser | A modern desktop or mobile browser; use HTTPS for remote deployment |

## Project structure

```text
Tooku/
├── .github/workflows/         # Image publishing workflow triggered by GitHub Releases
├── src/                       # Frontend and shared business rules
│   ├── api/                   # API requests and data conversion
│   ├── assets/                # Build assets such as fonts
│   ├── components/            # Shared UI components
│   ├── domain/                # Data types and business rules
│   ├── features/              # Player, playlists, lyrics, recommendations and more
│   ├── pages/                 # Login, home, search, settings and other pages
│   ├── pwa/                   # Service Worker
│   ├── state/                 # Application state and preferences
│   └── storage/               # Browser storage and account synchronization
├── server/                    # Node backend and SQLite data service
├── public/                    # Brand assets, PWA manifest and license texts
├── scripts/                   # Startup, environment checks and maintenance tools
├── docs/                      # English documentation, screenshots and third-party notices
├── .env.example               # Environment configuration example
├── compose.yaml               # Docker Compose configuration for the published image
├── Dockerfile                 # Docker image build configuration
├── package.json               # Project information, dependencies and commands
└── pnpm-lock.yaml             # Dependency lockfile
```

## Quick start

### Local development

1. Clone the project:

   ```bash
   git clone https://github.com/Dewsweet/Tooku.git
   cd Tooku
   ```

2. Install dependencies:

   ```bash
   npx --yes pnpm@11.25.0 install --frozen-lockfile
   ```

3. Copy [.env.example](../.env.example) to `.env` and enter your actual Navidrome address. The example uses port `4533`:

   ```dotenv
   NAVIDROME_UPSTREAM=http://127.0.0.1:4533
   ```

4. Start the development service:

   ```bash
   npm run dev
   ```

The default address is `http://127.0.0.1:18733`; check the terminal for the actual address. Enter your Navidrome address on the login page and sign in with your Navidrome account.

### Production

After installing dependencies, run:

```bash
npm run build
npm start
```

The default address is `http://127.0.0.1:18733`. Set `TOOKU_HOST` and `TOOKU_PORT` to change the listening address and port.

The production Node service receives configuration through process environment variables and does not automatically read the development `.env` file. To load that file, replace `npm start` with `node --env-file=.env server/index.ts`. The website and APIs must be served by the same Node service; hosting only `dist` as static files is insufficient.

Native data is stored in `.local/data` by default. Keep both the data and its encryption key when migrating.

### Docker

Save the following as `compose.yaml` and change `NAVIDROME_UPSTREAM` to your Navidrome address. No `.env` file is needed:

```yaml
services:
  tooku:
    image: dewsweet/tooku:v0.1.0
    container_name: tooku
    restart: unless-stopped
    ports:
      - "18733:8080"
    environment:
      NAVIDROME_UPSTREAM: http://192.168.1.10:4533
      TOOKU_SECRET_KEY_FILE: /run/tooku-secret/tooku-secret.key
    volumes:
      - ./data:/data
      - ./secret:/run/tooku-secret
```

For the first installation, create the `data` and `secret` directories and allow the container user `1000:1000` to write to them. On a Linux host, run these commands in the directory containing the configuration:

```bash
mkdir -p data secret
sudo chown 1000:1000 data secret
docker compose up -d
```

To update, change the version tag in `image`, then run:

```bash
docker compose pull
docker compose up -d
```

`data` and `secret` store data and encryption keys respectively; keep both when migrating. Existing deployments should retain their original mounts. Data in named volumes will not automatically migrate into these two directories.

### Proxy
If Tooku uses a non-default port after the reverse proxy and gets stuck during the server address detection due to a mismatch in the `Host` header, you can modify the following fields in the `location` block that actually proxies Tooku. After saving, check the configuration and reload Nginx.

```nginx
proxy_set_header Host $http_host;
proxy_set_header X-Forwarded-Proto $scheme;
```


## Feedback

Report issues through [GitHub Issues](https://github.com/Dewsweet/Tooku/issues), including your browser, deployment method, reproduction steps and error message.
Do not include passwords, cookies, authenticated URLs or complete account backups.

This project is primarily for personal use and will be maintained according to actual usage needs.

## License

Tooku is licensed under the [MIT License](../LICENSE).

Third-party dependencies, Source Han fonts and the Navidrome logo retain their respective licenses. See the [third-party notices](THIRD_PARTY_NOTICES.md).

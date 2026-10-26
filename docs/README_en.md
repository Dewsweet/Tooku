<p align="center"><img src="../public/tooku.svg" width="96" alt="Tooku"></p>

# Tooku

[简体中文](../README.md) · English

A self-hosted, third-party Navidrome web player with a Chinese-language interface. Browse your library on desktop or mobile, play music with lyrics, and keep preferences and queue snapshots under your account.

Navidrome manages your music, scans, favorites, playlists and transcoding. Tooku provides the web interface, playback controls, managed connections and a small account-data service. It is not an official Navidrome project.

**Version 0.1.0 — an early public preview.** Basic login, playback, account synchronization, Docker operation and HTTPS reverse proxying have received real-world usage feedback. Compatibility still depends on the browser, audio format and deployment environment.

## Features

- Albums, artists, favorites, search, listening history and playlists; playlist ordering, folders and custom artwork.
- Sequential, shuffle and repeat playback, queue and position snapshots, system media controls and bounded playback recovery.
- Adjustable fade-in/out, an expanded player, mobile layouts and browser fullscreen.
- Local-first lyrics, bilingual text, timing offsets and local word timestamps; optional NetEase / QQ lyric lookup and desktop picture-in-picture lyrics.
- Account data stored in Tooku SQLite, with browser-to-browser retrieval, export and restore. Login passwords are not stored.
- Optional Last.fm / AI recommendations with verified platform links, plus a lightweight installable PWA shell.

Tooku does not cache music for offline listening, manage downloads, provide real-time remote playback control or scan an independent music library. Formats and transcoding depend on Navidrome and the browser. Picture-in-picture and installation depend on browser support. External lyric and recommendation services are optional and may vary by region or upstream availability.

## Deploy with Docker

You need Docker Compose and a Navidrome server reachable from the container. Build the image from this repository; a prebuilt image is not required.

The GitHub Actions / Docker Hub publishing process is not configured yet. These instructions continue to build from source; image addresses and configuration will be documented when available.

```bash
git clone https://github.com/Dewsweet/Tooku.git
cd Tooku
```

Create `.env` in the project directory and replace the example Navidrome address:

```dotenv
NAVIDROME_UPSTREAM=https://music.example.com:22443
TOOKU_BIND_ADDRESS=127.0.0.1
TOOKU_HTTP_PORT=8080
```

```bash
docker compose up --build -d
docker compose ps
```

Open `http://127.0.0.1:8080`, enter the Navidrome address and sign in with your Navidrome account. To access Tooku from your LAN, set `TOOKU_BIND_ADDRESS` to the Docker host's actual LAN IP.

**Inside a container, `127.0.0.1` refers to that container.** For Navidrome on the Docker host, use a reachable listener such as `http://host.docker.internal:4533`; for another machine, use its reachable address.

Main settings:

| Setting | Purpose |
| --- | --- |
| `NAVIDROME_UPSTREAM` | Default Navidrome base URL; ports and subpaths are supported, authentication parameters are not |
| `TOOKU_BIND_ADDRESS` | Host address for the Docker port mapping; loopback by default |
| `TOOKU_HTTP_PORT` | Published Docker port; defaults to `8080` |
| `TOOKU_ALLOW_PRIVATE_NAVIDROME` | Allow registering other private-network servers at login; defaults to `false`. The configured default upstream remains supported |
| `TOOKU_TRUST_PROXY` | Trust the HTTPS protocol header from a controlled proxy; defaults to `false` |
| `TOOKU_COOKIE_SECURE` | Force Secure session cookies; defaults to `false` |
| `TOOKU_HSTS` | Send HSTS on trusted HTTPS responses; defaults to `false` |

Docker Compose reads `.env` automatically. During local development, Vite reads `NAVIDROME_UPSTREAM` from it. For native production, supply configuration through process environment variables.

## HTTPS and Nginx

Use HTTPS for remote access and proxy the **entire site** to the Tooku Node service. Serving only `dist` will not provide session, account-data, lyric or recommendation APIs.

Keep these headers in every location that actually proxies Tooku requests:

```nginx
proxy_set_header Host $http_host;
proxy_set_header X-Forwarded-Proto $scheme;
```

`$http_host` preserves the public port. If public port `22443` maps to internal port `443`, using `$host` drops that port and can fail same-origin checks. Check included location files as well as the outer server block.

Enable `TOOKU_TRUST_PROXY=true` only when clients cannot bypass the controlled proxy and the proxy overwrites the protocol header correctly. Enable forced Secure cookies and HSTS as appropriate after validating HTTPS. The template also preserves Range requests, limits uploads and disables access logging for temporary playback grants.

## Data

- Navidrome owns music, playlists, favorites and transcoding settings.
- Tooku stores avatars, custom artwork, folders, preferences, queue snapshots and listening history. Browsers also keep local caches and device display settings.
- Docker mounts `tooku-data` at `/data` and a separate `tooku-security-key` volume at `/run/tooku-secret`.
- A full migration needs both the data volume and its original key volume. Do not use `docker compose down -v` when upgrading.
- Account JSON exports exclude login credentials and external service secrets. Restored queue/history snapshots take effect on the next login.

The native default data directory is `.local/data`. Databases, keys, `.env` and runtime caches must stay outside the source repository.

## Local development and native production

Use **Node.js 24.22.1 or later**. Dependencies are locked with pnpm; a global pnpm installation is not needed:

```bash
npx --yes pnpm@11.25.0 install --frozen-lockfile
npm run dev
```

The default development address is `http://127.0.0.1:18733`; check the terminal for the actual address. Use `npm run dev:lan` for phone testing, then open the computer's LAN address.

For native production:

```bash
npm run build
npm start
```

`vite preview` only previews static output and does not replace the Tooku backend.

Basic checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

`npm test` runs the Node smoke tests included in the source. The full `tests/` regression suite is kept locally by the maintainer and runs automatically when present. Public source excludes that directory and the artist artwork probe script; neither is needed to build or run Tooku.

Run `npm run security:audit`, `npm run security:licenses` and `npm run container:check` for dependency audits, license checks and container configuration checks. Without Docker, the container command runs static checks only.

## Layout

| Directory | Purpose |
| --- | --- |
| `src/` | React interface and shared domain types/rules |
| `server/` | Node HTTP, SQLite, sessions, Navidrome proxy, lyrics and recommendations |
| `public/` | Brand assets, PWA manifest and license texts |
| `scripts/` | Launchers, environment checks, licensing and dependency audit tools |

One Node process serves the built interface and APIs; no separate database service is needed. The frontend uses React, TypeScript and Vite, with TanStack Query for server queries, Zustand for interface state and IndexedDB for local snapshots.

## Feedback

Use [GitHub Issues](https://github.com/Dewsweet/Tooku/issues) to report the browser, deployment method, reproduction steps and error message. Passwords, cookies, authenticated URLs and complete account backups are not needed. The PWA keeps its basic shell; ongoing work focuses on actual usage issues and stability.

## License

Tooku's original code is licensed under the [MIT License](../LICENSE). Copyright © 2026 Dewsweet.

Dependencies, Source Han fonts and the Navidrome logo retain their respective licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The project license does not replace third-party terms or imply affiliation with Navidrome or external music platforms.

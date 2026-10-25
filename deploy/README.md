# Deployment notes / 部署补充

[简体中文](../README.md) · [English](../README.en.md)

The root Compose file builds Tooku from source and publishes it on loopback by default. The runtime uses UID/GID 1000, a read-only root filesystem, a temporary `/tmp`, dropped capabilities and resource limits. Node serves both the built interface and APIs.

## Upstream and networking

Set `NAVIDROME_UPSTREAM` to a Navidrome base URL reachable from the container. A port and subpath are supported; do not include credentials, query parameters or fragments. A loopback URL inside Docker points to that container, not another computer.

To join an existing Docker network, set the following in your Compose `.env` and adapt the example service/network names:

```dotenv
NAVIDROME_UPSTREAM=http://navidrome:4533
NAVIDROME_NETWORK=media
```

```bash
docker compose -f compose.yaml -f deploy/compose.same-network.yaml up --build -d
```

The configured default upstream supports private addresses. Registering additional private servers at login requires `TOOKU_ALLOW_PRIVATE_NAVIDROME=true`; metadata/link-local and other disallowed destinations remain blocked.

## Reverse proxy

Adapt `default.conf.template` to your HTTPS gateway. Replace `${TOOKU_UPSTREAM}` with the Tooku Node address, such as `http://127.0.0.1:8080`, or substitute it with your template tooling. The template is not automatically loaded by the Tooku image. Keep the actual TLS listen/certificate configuration supplied by your gateway.

Proxy the entire site. Preserve the public Host **including its port** in every active proxy location:

```nginx
proxy_set_header Host $http_host;
proxy_set_header X-Forwarded-Proto $scheme;
```

A location that defines its own `proxy_set_header` directives does not inherit that directive set from the server block. Check included proxy files as well. If public port 22443 maps to internal 443, do not substitute `$host` or `$host:$server_port` for the original public Host.

Only enable `TOOKU_TRUST_PROXY=true` behind a controlled proxy that clients cannot bypass. The TLS-terminating gateway must overwrite the protocol header; with multiple proxy hops, pass the correct HTTPS scheme through the controlled chain. Keep only one effective X-Forwarded-Proto value. Enable forced Secure cookies and HSTS once the HTTPS entry is working. HTTP redirects must target the actual public HTTPS port.

Preserve Range and If-Range for seeking. The template permits 13 MiB request bodies and 300-second upstream timeouts. Playback grant paths and upstream authenticated query strings must not enter access/error logs; retain the template's logging settings when adapting it.

## Persistent data

| Volume | Mount | Contents |
| --- | --- | --- |
| `tooku-data` | `/data` | Account SQLite database, encrypted security database and lyric cache |
| `tooku-security-key` | `/run/tooku-secret` | Original encryption key |

Back up both volumes together while Tooku is stopped for a consistent full snapshot. Restore into fresh volumes and keep the original key paired with its database. Account JSON exports do not include login or external service credentials. Do not use `docker compose down -v` when retaining data.

A native deployment uses `.local/data` by default; set `TOOKU_DATA_DIR` and `TOOKU_SECRET_KEY_FILE` to choose other storage locations. Keep these files outside the web root and repository.

## Updates and health

Keep a copy of the current image and paired data/key snapshot before changing versions. Build from the new source and reuse your existing Compose project and volumes:

```bash
docker compose build tooku
docker compose up -d --no-build
docker compose ps
docker compose exec tooku node scripts/container-healthcheck.mjs
```

If you build a separately tagged image with `docker build -t tooku:VERSION .`, either tag it as `tooku:local` or override the Compose `image` field before running `up --no-build`. Preserve the old image for rollback; an older application may require its matching pre-upgrade data/key snapshot.

A successful healthcheck confirms the Tooku process and API identity, not every upstream operation. Browser/audio support, full restore, architecture compatibility and image vulnerability results depend on the actual deployment; do not infer them solely from a healthy container.

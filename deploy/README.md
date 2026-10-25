# Tooku 容器部署

根目录 `compose.yaml` 是生产基线：Tooku 以 UID/GID 1000 运行，根文件系统只读，仅 `/tmp`、账号数据卷和独立密钥卷可写；容器不保留 Linux capabilities，并限制 PID、内存与 CPU。默认只监听宿主机 `127.0.0.1:8080`。

## 上游 Navidrome

Navidrome 在宿主机 44533 时可直接启动：

```powershell
docker compose up --build -d
docker compose ps
docker compose exec tooku node scripts/container-healthcheck.mjs
```

Navidrome 与 Tooku 位于同一个已有 Docker 网络时，使用叠加文件。下面示例假定网络名为 `media`、服务名为 `navidrome`、容器端口为 4533：

```powershell
$env:NAVIDROME_NETWORK = 'media'
$env:NAVIDROME_UPSTREAM = 'http://navidrome:4533'
$env:TOOKU_ALLOW_PRIVATE_NAVIDROME = 'true'
docker compose -f compose.yaml -f deploy/compose.same-network.yaml up --build -d
```

远程 HTTPS 上游不需要额外代理容器：

```powershell
$env:NAVIDROME_UPSTREAM = 'https://music.example.com'
docker compose up --build -d
```

地址可包含 Navidrome 子路径，但不能包含用户名、密码、query、hash 或尾斜杠。`NAVIDROME_UPSTREAM` 始终作为默认和兼容上游。登录页登记其他公网 HTTP(S) Navidrome 无需额外开关；若还要登记局域网、Docker 内网或回环地址，显式设置 `TOOKU_ALLOW_PRIVATE_NAVIDROME=true`。该开关允许 Tooku 服务进程访问私网地址，应只在可信用户可访问的部署中启用；链路本地、云元数据地址、未识别服务和重定向仍会被拒绝。

## 数据、密钥与备份

- `tooku-data` 保存账号数据库、凭据安全库及歌词缓存。
- `tooku-security-key` 只保存 AES-256-GCM 主密钥，和数据库分卷挂载。
- 两个卷都由 UID/GID 1000 使用；镜像中的挂载点权限为 `0700`，新生成的密钥权限为 `0600`。
- 不要执行 `docker compose down -v`，也不要把密钥内容放入 Compose、环境变量、镜像层或日志。

当前账号数据库可在线备份：

```powershell
docker compose exec tooku node server/backup.ts /data/tooku-backup.sqlite
docker compose cp tooku:/data/tooku-backup.sqlite ./tooku-backup.sqlite
```

完整迁移或回滚前先执行 `docker compose stop tooku`，再分别快照 `tooku-data` 和 `tooku-security-key`。安全库与原密钥必须成对保留；恢复旧数据库时不要生成新密钥，也不要让旧 `-wal` / `-shm` 留在恢复目标旁。卷快照和恢复命令取决于所用的 Docker 存储驱动或备份系统，应在副本上验证后再用于正式数据。

## HTTPS 入口

不要直接把容器的 8080 端口暴露到公网。让 HTTPS 反向代理转发整个站点到 `127.0.0.1:8080`，可参考 `default.conf.template`。模板关闭短期播放授权路径的访问日志，保留单段 Range / If-Range，允许最长 300 秒的上游响应，并将普通请求正文限制为 13 MiB。

Node 服务收到的 `Host` 必须与浏览器访问的公开域名和端口一致。在实际处理 Tooku 请求的每个 `location`（含单独的 `/api`、播放路径）中保留：

```nginx
proxy_set_header Host $http_host;
proxy_set_header X-Forwarded-Proto $scheme;
```

`$http_host` 保留浏览器原始端口；`$host` 会丢失非默认公开端口，默认的 `$proxy_host` 则可能变成 fnOS 的内网地址，均可能导致 POST 的 Origin 与 Host 不匹配。公网端口经 NAT 转发时也不要拼接 `$host:$server_port` 代替原始 Host。参考 [Nginx proxy_set_header 文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header)。Nginx 的 `proxy_set_header` 按配置层级继承；若某个 location 自己定义了其他请求头，应在该 location 同样检查 Host 和 HTTPS 转发，不假设一定继承 server 层设置。

若“直连同一个 Tooku 容器正常，HTTPS 反代后任何 Navidrome 地址都被拒绝”，先区分 `/api/tooku/connection` 的错误：`connectionError: origin` 表示 Tooku 请求来源校验失败，发生在地址解析之前；`private` / `policy` 才是目标地址策略；无原因码的 403 还可能来自外层代理。旧版前端曾将全部 403 误报为地址策略，旧服务返回的固定“仅允许同源访问。”也由新版前端识别为反代诊断。不要移除/改写 Origin、允许任意跨源或关闭地址校验；`TOOKU_TRUST_PROXY=true` 只用于已受控代理的 HTTPS 识别，不会绕过 Host 校验。无需提供账号、Cookie 或认证 URL即可排查这一步。

只有 Node 端口不能被客户端绕过、代理会覆盖客户端传入的 `X-Forwarded-Proto`，且最终入口已全站 HTTPS 时，才启用下面三个开关：

```powershell
$env:TOOKU_TRUST_PROXY = 'true'
$env:TOOKU_COOKIE_SECURE = 'true'
$env:TOOKU_HSTS = 'true'
docker compose up -d
```

## 升级、回滚与检查

升级前保存两个卷的快照，然后构建带明确版本标签的镜像。不要只复用不可追溯的 `latest`：

```powershell
docker build --pull -t tooku:2026-10-23 .
docker tag tooku:2026-10-23 tooku:local
docker compose up -d --no-build
docker compose ps
docker compose logs --tail 100 tooku
```

Compose 使用 `tooku:local`，因此构建版本镜像后必须将该镜像标记为 `tooku:local` 再重建服务；否则 `--no-build` 可能继续使用旧本地镜像。保留原版本标签用于回滚，回滚时将目标版本重新标记为 `tooku:local`，并先确认它可读取当前数据结构；涉及数据降级时使用配套的数据库和密钥卷快照。

发布验收至少包含：健康状态变为 healthy；登录后重建容器仍能恢复账号数据和会话；原始流、兼容 MP3、seek/206 Range、歌手图上传与账号备份可用；停止期间生成的两个卷快照能在隔离环境恢复；回滚到上一镜像仍可读取未发生结构降级的数据。基础镜像提供 amd64/arm64 清单，但 Tooku 只有在目标架构实际完成构建和播放验证后才应宣称支持该架构。

仓库内的静态检查可在没有 Docker 的环境执行；安装 Docker 后同一命令还会执行 `docker compose config --quiet`：

```powershell
npm.cmd run container:check
```

最终镜像应在每次发布时扫描。示例：

```powershell
trivy image --severity LOW,MEDIUM,HIGH,CRITICAL --ignore-unfixed=false tooku:2026-10-23
```

运行层会删除构建所需的 npm/corepack，并用 `node server/index.ts` 直接启动，以免把未使用的包管理器漏洞带入最终镜像。构建层仍需 pnpm，但不会复制到运行层。

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
docker compose up -d --no-build
docker compose ps
docker compose logs --tail 100 tooku
```

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

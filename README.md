<p align="center"><img src="public/tooku.svg" width="96" alt="Tooku"></p>

# Tooku

简体中文 · [English](README.en.md)

一个面向中文用户的自托管 Navidrome 第三方网页播放器。支持桌面与手机浏览、连续播放、歌词，以及按账号保存的界面偏好和播放队列。

Navidrome 负责音乐库、扫描、收藏、歌单与转码；Tooku 提供网页界面、播放控制、受管连接和少量个性数据存储。本项目不属于 Navidrome 官方项目。

**当前版本：0.1.0，早期公开测试版。** 基础登录、播放、跨浏览器数据同步、Docker 运行及 HTTPS 反代已有实际使用反馈；不同音频格式、浏览器和部署环境仍可能存在兼容差异。

## 功能

- 专辑、歌手、收藏、搜索、最近收听与歌单浏览；歌单排序、文件夹及自定义图片。
- 顺序、随机和循环播放，队列与进度快照、系统媒体控制、有限次数的播放故障恢复。
- 可调淡入淡出；完整播放器、移动端布局与浏览器全屏。
- 本地歌词优先，支持双语、偏移和本地逐词时间戳；可选网易云 / QQ 歌词及桌面画中画歌词。
- 账号数据保存在 Tooku SQLite，支持浏览器间读取、导出和恢复；登录密码不保存。
- 可选 Last.fm / AI 音乐推荐及已核实的平台链接；基础 PWA 安装能力。

Tooku 不缓存离线歌曲，也不提供下载管理、实时跨设备播放控制或独立音乐库扫描。音频格式和转码能力取决于 Navidrome 与浏览器；画中画和 PWA 取决于浏览器支持。外部歌词、推荐服务属于可选功能，可能受上游变化和地区影响。

## Docker 部署

需要一台运行 Docker Compose 的主机，以及容器能够访问的 Navidrome 服务。当前仓库提供源码构建，不要求使用预构建镜像。

```bash
git clone https://github.com/Dewsweet/Tooku.git
cd Tooku
```

在项目目录创建 `.env`，将示例地址替换为你的实际 Navidrome 地址：

```dotenv
NAVIDROME_UPSTREAM=https://music.example.com:22443
TOOKU_BIND_ADDRESS=127.0.0.1
TOOKU_HTTP_PORT=8080
```

```bash
docker compose up --build -d
docker compose ps
```

本机访问 `http://127.0.0.1:8080`，填写 Navidrome 地址并使用其账号登录。需要局域网访问时，将 `TOOKU_BIND_ADDRESS` 改为 Docker 主机实际的局域网 IP。

**容器中的 `127.0.0.1` 是容器自身。** Navidrome 在 Docker 主机上时可按实际监听情况使用 `http://host.docker.internal:4533`；在其他设备上时填写对应可达地址。Navidrome 与 Tooku 在同一个已有 Docker 网络中时，可使用 [同网络叠加配置](deploy/compose.same-network.yaml)。

主要配置：

| 配置 | 说明 |
| --- | --- |
| `NAVIDROME_UPSTREAM` | 默认 Navidrome 基址，可含端口和子路径，不含认证参数 |
| `TOOKU_BIND_ADDRESS` | Docker 映射的主机地址，默认仅回环 |
| `TOOKU_HTTP_PORT` | Docker 对外端口，默认 `8080` |
| `TOOKU_ALLOW_PRIVATE_NAVIDROME` | 是否允许登录时登记其他私网地址，默认 `false`；已配置的默认上游始终兼容 |
| `TOOKU_TRUST_PROXY` | 是否信任受控代理的 HTTPS 协议头，默认 `false` |
| `TOOKU_COOKIE_SECURE` | 是否强制会话 Cookie 使用 Secure，默认 `false` |
| `TOOKU_HSTS` | 是否对可信 HTTPS 响应发送 HSTS，默认 `false` |

`.env` 自动用于 Docker Compose；本机开发的 Vite 读取其中的 `NAVIDROME_UPSTREAM`。直接运行生产 Node 服务时，应通过进程环境设置配置。

## HTTPS 与 Nginx

远程入口使用 HTTPS，并将**整个站点**反代到 Tooku Node 服务。参考 [Nginx 模板](deploy/default.conf.template)和[部署说明](deploy/README.md)。不要只托管 `dist`，否则登录会话、用户数据、歌词和推荐 API 不可用。

在实际转发请求的每个 `location` 中保留：

```nginx
proxy_set_header Host $http_host;
proxy_set_header X-Forwarded-Proto $scheme;
```

`$http_host` 保留公开端口。若公网 `22443` 映射内部 `443`，使用 `$host` 会丢失端口，导致同源校验失败。被 `include` 的 location 也需检查，不能只修改 server 层。

仅在客户端不能绕过受控代理直连 Node、代理正确覆盖协议头时启用 `TOOKU_TRUST_PROXY=true`。全站 HTTPS 验证正常后，再按需启用 Secure Cookie 和 HSTS。模板还包含 Range 转发、上传限额以及播放授权路径不记录访问日志的设置。

## 数据保存

- 音乐、歌单、收藏和转码配置由 Navidrome 管理。
- Tooku 保存头像、自定义图片、文件夹、偏好、队列和收听历史；浏览器保留本地缓存与设备显示偏好。
- Docker 的 `tooku-data` 卷挂载到 `/data`，独立 `tooku-security-key` 卷挂载到 `/run/tooku-secret`。
- 完整迁移需同时保留数据卷和原密钥卷。不要在升级时执行 `docker compose down -v`。
- 设置中的账号 JSON 备份不包含登录凭据或第三方服务密钥；恢复队列和历史在下次登录时应用。

本机默认数据目录为 `.local/data`。数据库、密钥、`.env` 和运行缓存均不应提交到源码仓库。

## 本机运行与开发

需要 **Node.js 24.22.1 或更新版本**。依赖由 pnpm 锁定，无需安装全局 pnpm：

```bash
npx --yes pnpm@11.25.0 install --frozen-lockfile
npm run dev
```

默认开发地址为 `http://127.0.0.1:18733`，以终端实际输出为准。Windows 可使用 `npx.cmd` / `npm.cmd`，或双击 `start-tooku.cmd`。手机调试可运行 `npm run dev:lan`，随后访问电脑的局域网地址。

本机生产运行：

```bash
npm run build
npm start
```

`vite preview` 只预览静态文件，不能替代 Tooku 后端。

基础检查：

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

依赖审计、第三方许可检查与容器配置检查分别为 `npm run security:audit`、`npm run security:licenses` 和 `npm run container:check`。没有 Docker 时，最后一项只执行静态检查。

## 项目结构

| 目录 | 作用 |
| --- | --- |
| `src/` | React 前端，以及共享业务类型和规则 |
| `server/` | Node HTTP、SQLite、会话、Navidrome 代理、歌词与推荐服务 |
| `public/` | 品牌图片、PWA 清单及许可文本 |
| `tests/` | 单元、界面和接口回归测试 |
| `scripts/` | 启动、环境检查、许可与依赖审计工具 |
| `deploy/` | Nginx 与 Docker 网络部署配置 |

生产环境使用同一个 Node 进程提供前端构建和后端接口，不需要单独数据库服务。前端采用 React / TypeScript / Vite；服务查询使用 TanStack Query，界面状态使用 Zustand，本机快照使用 IndexedDB。

## 反馈

请通过 [GitHub Issues](https://github.com/Dewsweet/Tooku/issues)反馈问题，说明浏览器、部署方式、复现步骤和错误提示。无需提供密码、Cookie、认证 URL 或完整账号备份。基础 PWA 能力保留，后续以实际使用问题和稳定性维护为主。

## 许可证

Tooku 原创代码采用 [MIT License](LICENSE)，版权所有 © 2026 Dewsweet。

第三方依赖、思源字体和 Navidrome 图标保留各自许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。项目许可证不改变这些第三方内容的授权，也不代表与 Navidrome 或外部音乐平台存在隶属关系。

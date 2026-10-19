# Tooku

面向中文用户的 Navidrome 第三方网页播放器。目标是让自己的音乐库更好找、更好听、更好看。

当前状态：**可运行的开发工程，真实曲库已进行基础联调，尚未完成发布验收**。保留 Apple Music 的简洁视觉，主界面现采用 Spotify 式全局头部与三栏布局，明暗模式与主题色可选。本地 Git 已提交基线，本轮功能在 codex/library-workspace 分支；没有远程推送。

## 本地运行

需要 Node.js 22.12+，本次使用 Node 24.15.0。**无需安装全局 pnpm**：已有依赖时可双击根目录 [start-tooku.cmd](start-tooku.cmd)，或通过 npm 启动。

```powershell
Set-Location G:\Code\Tooku
npm.cmd run dev
```

终端需保持运行，按 Ctrl+C 停止后地址将无法访问。电脑重启后双击启动脚本，脚本会启动服务并自动打开浏览器；需保持窗口打开。重复启动会打开已经运行的 Tooku。如果首次下载项目、尚无 node_modules，脚本会使用 `npx.cmd --yes pnpm@11.25.0 install --frozen-lockfile` 安装锁定依赖，不依赖系统 PATH 中的 pnpm。

默认打开 `http://127.0.0.1:18733/`；端口被占用或被 Windows 保留时，启动器会在 18733–18742 中尝试其他端口，实际地址显示在终端并写入本机 `.local/server-url.txt`。旧端口 5173 在本机 Windows 保留范围内，会报 EACCES，因此已更换。可通过进程环境变量 `TOOKU_PORT` 指定首选端口，无需更改系统网络设置。

登录页默认 `/nd` 经开发代理连接本机 `http://127.0.0.1:44533`。使用你自己的 Navidrome 用户名和密码；也可输入完整服务地址直连。账号和 token 只在内存，不写入环境文件。刷新页面需要重新登录，同一账号的本机队列可以暂停恢复。

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

现已实现：登录和扩展检测、专辑/歌手浏览、中文输入法安全的检索、收藏、普通歌单与保存核实、常驻播放器、队列与循环/随机、逐行/静态歌词、歌词偏移、Media Session、本机快照/收听历史、响应式与主题设置。**实现不代表所有 Navidrome 音频格式、权限和扩展都已实测。**

实际验证和待办见 [开发记录](docs/09-development-status.md)。PWA、拼音搜索、双语/逐词歌词、在线歌词、服务端队列同步和高级音频实验尚未实现。

新版主页展示曲库概览、歌单和专辑。Logo/主页/搜索位于头部，右上角为头像和设置；真实曲库在设置中切换。播放侧栏可选择版块与顺序，歌单文件夹继续独立管理。头像、布局和分类仅保存于当前浏览器，歌单内容仍在 Navidrome；本轮改动和待人工确认项见 [主页改版与人工清单](docs/11-home-refresh-and-checklist.md)。

## 可选 Docker 部署

已准备 [Dockerfile](Dockerfile)、[Compose](compose.yaml) 和 Nginx 固定上游代理模板。此电脑未安装 Docker，容器构建/运行仍待验证。

```powershell
docker compose up --build -d
```

配置通过 `http://127.0.0.1:8080/` 提供 Tooku，`NAVIDROME_UPSTREAM` 默认指向宿主机 44533；容器中的 localhost 是容器自身。若 Navidrome 位于其他容器/设备或子路径，先调整 Compose 中的上游地址（不要带尾斜杠）。Linux 上服务只绑定 127.0.0.1 时，host-gateway 并不保证能连接，应选择适合实际部署的网络方案。当前示例只绑定本机，远程使用需配置 HTTPS 与访问入口。

## 独立测试服务

浏览器验收可启动内存测试服务，它不会代理或写入真实 Navidrome：

```powershell
node tests/fixtures/server.mjs
```

另一个终端运行 `npm.cmd run dev`，登录地址填 `http://127.0.0.1:44534`，用户名填 `fixture`，密码可填任意非空测试文本。封面、曲目与 12 秒音频全部是生成的测试数据，重启即重置。测试服务没有真实认证，仅供本机开发，不能作为音乐服务部署。

## 已确认的开发环境

2026-10-13 对本地服务进行了不带账号的只读检查：

| 项目 | 结果 |
| --- | --- |
| 工作目录 | `G:\Code\Tooku`，最初为空，现已初始化 Git 并创建工程 |
| Navidrome 地址 | `http://127.0.0.1:44533` |
| 服务版本 | `0.64.1 (285dc4f3)` |
| REST 协议标识 | `1.16.1`，`openSubsonic: true` |
| 未认证 ping | HTTP 200，业务状态 failed，错误码 10：缺少 u |
| CORS 初步观察 | 带 `Origin: http://localhost:5173` 的未认证 GET 返回 `Access-Control-Allow-Origin: *` |

以上是 10 月 13 日的无账号检查。10 月 14 日已使用专用测试账号验证真实登录、曲库封面、FLAC 播放及 seek；更多格式、转码与真实写入权限仍待验收，详见开发记录。

## 推荐路线

独立开发 React + TypeScript + Vite 网页应用，以 Subsonic / OpenSubsonic 为主要数据协议，使用常驻 HTMLAudioElement 播放。先完成登录、浏览、搜索、队列、收藏、歌单、逐行歌词与响应式界面，再加入拼音搜索、双语/逐词歌词、PWA 和高级音频实验。

核心差异化：中文输入与检索体验、精致且可降级的歌词页、明确可控的播放队列、稳定的连续听歌流程。首页内容来自用户自己的音乐库。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [项目调研](docs/01-research.md) | 参考项目、来源、复用取舍、许可证事实 |
| [产品需求](docs/02-product-requirements.md) | 用户场景、功能优先级、首版范围 |
| [交互与视觉](docs/03-design.md) | 信息架构、页面布局、播放器与中文规范 |
| [技术架构](docs/04-architecture.md) | 技术栈、模块边界、状态与存储设计 |
| [接口对接](docs/05-api-integration.md) | 认证、能力检测、接口映射、错误与降级 |
| [播放器设计](docs/06-player.md) | 状态机、队列、歌词时钟、兼容性限制 |
| [开发计划](docs/07-roadmap.md) | 里程碑、任务依赖、工期估算与验收门槛 |
| [开发与验收](docs/08-development-and-testing.md) | 本地联调、部署方案、测试矩阵、发布标准 |
| [主页改版与人工清单](docs/11-home-refresh-and-checklist.md) | 当前布局、头像、侧栏配置及人工验收 |
| [主界面说明](docs/10-library-workspace.md) | 曲库切换、文件夹、设置和存储边界 |
| [开发记录](docs/09-development-status.md) | 实现进度、真实/模拟验证边界与下一步 |

下一步继续完成 M0 代表性格式、转码、真实歌词、权限和写入验收，并迭代播放器细节。依赖许可证已记录于 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，可用 `node scripts/license-notices.mjs` 重新生成；Tooku 原创代码的开源许可尚未指定。

# 开发、联调与验收

> 当前任务级验证尺度见 [AGENTS.md](../AGENTS.md) 和 [开发接入指南](12-agent-development-guide.md)。本文保留发布前验证矩阵与历史环境信息；用户目前要求基础检查后把少量人工查看项直接写在回复中，不为每次改动另建验收清单文档。

本文件是开发与发布验收约定。现已创建 package.json、可运行开发应用及可选 Docker 配置，实际命令见 [README](../README.md)，验证结果见 [开发记录](09-development-status.md)。本文片段保留为原理示例，实际配置以工程文件为准；Docker 尚未实机验证。

## 环境与工程初始化

建议 Node.js 22.12+ 或经当前 Vite 验证的更新版本、pnpm；固定 packageManager、engines 和 lockfile。[Vite 官方要求](https://vite.dev/guide/)当前列出 Node 20.19+ / 22.12+，模板可能有更高要求。不要依据参考项目的旧 README 随意锁定旧运行时。

初始化应保留现有文档；可先在临时子目录生成模板，再将所需工程文件整合到根目录。Git 初始化和首个提交留到实际工程阶段，凭据与私人样本不提交。

已实现的脚本与后续约定：

| 脚本 | 目的 |
| --- | --- |
| npm.cmd run dev（或 pnpm dev） | 本地开发，默认 18733，端口不可用时自动回退 |
| pnpm build / pnpm preview | 产物构建与本地预览 |
| pnpm lint / pnpm typecheck | 静态检查 |
| pnpm test | 核心单测与交互测试 |
| 手工浏览器验收 | 独立测试服务验证写入/歌词；真实服务已验证登录、FLAC 播放和 seek；test:e2e 自动化脚本尚未创建 |

源码和文档 UTF-8；领域 ID 为 string；接口时间/单位转换集中处理。依赖、API、缓存结构变更需更新对应文档和迁移。

## 本地只读诊断

以下命令当前可用，不需要账号，不读取曲库：

```powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:44533/' -UseBasicParsing -TimeoutSec 10
Invoke-RestMethod -Uri 'http://127.0.0.1:44533/rest/ping.view?v=1.16.1&c=TookuResearch&f=json' -TimeoutSec 10
```

未认证 ping 预期是 HTTP 200 + failed/code=10；这是可达性结果，不是登录成功。真实认证从应用登录页完成，不在 shell 历史或 URL 示例中粘贴密码、token 或 key。

本轮 GET 的 CORS 为 *，未观察到 Allow-Credentials；token 查询参数认证应使用无跨站 cookie 的请求模式，不设置 credentials=include 来“修复”问题。POST、流、封面和代理行为仍需浏览器核对。

## 开发同源代理示意

工程已配置 `/nd/rest` 到本机 Navidrome 的固定代理。以下为简化示意，实际入口和端口回退见 `scripts/dev-server.mjs`，代理配置见 `vite.config.ts`：

```ts
// server 配置简化示意
server: {
  host: '127.0.0.1',
  port: 18733,
  strictPort: true,
  proxy: {
    '/nd/rest': {
      target: 'http://127.0.0.1:44533',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/nd(?=\/|$)/, ''),
    },
  },
}
```

客户端服务基址默认为同源 `/nd`（应用内部解析为绝对 URL），请求 `/nd/rest/...`；也支持用户输入完整服务地址。

Windows 重启后端口保留范围可能变化。2026-10-14 本机 5141–5240 为排除范围，5173 绑定返回 EACCES，44533 的 Navidrome 正常。启动器只对保留/占用端口作有界重试，不修改系统网络设置；`.local/server-url.txt` 记录实际地址。启动器通过本机健康检查复用已运行的 Tooku，避免重复启动。当前没有安装开机自启任务；重启后双击根目录 `start-tooku.cmd` 即可。

手机联调时可显式绑定局域网接口，并从手机访问开发电脑地址；不要让手机请求自己的 127.0.0.1。局域网 HTTP 可用于基础联调，但不能代替 HTTPS 下的 PWA/安全上下文验收。没有变更本地 Navidrome 服务配置的默认需求。

## 正式静态部署示意

SPA 产物 + Nginx/Caddy 静态服务；推荐固定上游同源代理。支持根路径与应用子路径要分别验证。Nginx 根路径示意：

```nginx
location / {
    try_files $uri $uri/ /index.html;
}

location /nd/rest/ {
    proxy_pass http://127.0.0.1:44533/rest/;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 300s;
    proxy_set_header Range $http_range;
    proxy_set_header If-Range $http_if_range;
    # 不在包含凭据的请求路径记录默认 access log
    access_log off;
}
```

这里只展示路由，未包含完整 TLS/CSP/server 配置。转发 query 和 Range，响应 Content-Type/Content-Range/Accept-Ranges 等不能被静态回退篡改。Navidrome 若位于 base path，proxy_pass 按实际路径修改。

Docker 中的 127.0.0.1 指向容器自身；Navidrome 同 Compose 网络时用服务名，连接宿主机时选经平台验证的宿主地址。不能直接把上述本机示例原样搬进容器。禁止将账号密码放入 VITE_* 或静态 runtime config，这些值会公开给浏览器。

固定上游可锁定服务地址但仍需每用户认证；不使用共享管理员凭据代理所有用户。远程浏览器到 Tooku 使用 HTTPS，代理到受控内网服务的链路按实际网络配置保护。

## 测试分层

| 层 | 核心内容 | 为什么需要 |
| --- | --- | --- |
| 单元测试 | 队列算法、重复 entry、随机/循环、offset、时间单位、Unicode、URL 编码、收听阈值 | 这些错误难以靠截图发现，且会直接改变收听行为 |
| 契约/适配器 | 成功/failed envelope、缺字段/数组、POST 参数、歌词 v1/v2、不同权限 | 服务声明与实际 DTO 不一定一致 |
| 交互测试 | IME、拖动/键盘替代、弹窗焦点、写失败回滚、恢复暂停 | 防止看似完成但不能操作 |
| E2E | 登录→浏览→播放→队列→收藏/测试歌单→退出→换用户 | 验证页面、状态和真实服务的连接 |
| 实机检查 | 音频格式、移动后台、媒体键、音量、PWA | 自动化浏览器不能替代手机音频策略 |

测试歌单用唯一测试名称，与真实歌单隔离，记录创建和清理的 ID。收藏写入验证需恢复测试前状态；测试默认不修改原有歌单。私人样本必须经过授权，公共 fixture 不包含真实认证或不允许再分发的音频/歌词。

## 浏览器与资源矩阵

记录实际测试版本和日期，而不是永远声称“最新版支持”。桌面优先 Chrome、Edge、Firefox；移动至少 Android Chrome 与 iOS Safari 实机；macOS Safari 若无设备列为未测。

| 维度 | 样本/场景 |
| --- | --- |
| 音频 | MP3/AAC/FLAC 原始流，浏览器不支持格式的兼容流，多碟，长音频 |
| 内容 | 中文/繁体/日文、Emoji、组合字符、同名异版、缺封面/缺时长/缺歌手 |
| 歌词 | 无、静态、LRC、正负 offset、增强逐词、翻译/注音；双语长行 |
| 网络 | 本机、局域网、限速、高延迟、断网/恢复、认证失效 |
| 身份 | 两个账号、两台服务、只读/他人歌单、权限撤销、多标签页 |
| 库与队列 | 空库、少量曲目、1 万首样本库；1,000 条队列、重复歌曲 |
| 部署 | 直连、固定代理、根路径、子路径、容器上游地址、HTTPS |
| 设备状态 | 横竖屏、后台/锁屏、系统媒体键、页面刷新/重新登录、低动效 |

每个组合按风险选代表性样本，不强求全笛卡尔积。至少真实验证一个不支持格式的降级路径；没有样本时标未测。

## 发布前 P0 验收

- [ ] AUTH-01：成功/失败登录、退出取消请求与音频、账号隔离、base path。
- [ ] LIB-01 / SEARCH-01：分页与末页、中文 IME、旧结果取消、详情顺序。
- [ ] PLAY-01：真实音频、被阻止的自动播放、buffering/error、seek、移动音量降级。
- [ ] QUEUE-01：追加/下一首/调序/删除当前项、重复项、随机/循环与边界。
- [ ] RESTORE-01：刷新后登录并暂停恢复；无认证 URL 持久化；坏 schema 回退。
- [ ] FAV-01 / LIST-01：写入真实、权限解释、超时核实、保存读回、测试数据清理。
- [ ] LYRIC-01：静态/逐行/无歌词、偏移和点击定位；不依赖在线来源。
- [ ] HISTORY-01：此设备标识、有效收听与重复提交处理；播放报告不双计数。
- [ ] UX-01：双主题、360px、键盘/焦点、中文错误、无封面和空状态。
- [ ] 30 分钟连续播放与快速换曲无双声音、无旧歌污染；按 PRD 测量性能样本。
- [ ] 浏览器存储、日志、错误页面、产物中没有凭据；远程 HTTPS 与代理路径验证。
- [ ] 可复现构建、第三方许可记录、发布说明和未测/已知限制完整。

每个勾选需关联测试输出或人工记录，不凭实现文件存在勾选。P1/P2 没实现不阻碍 P0 发布；不能把核心 P0 未实现写成泛泛“浏览器限制”。

## 性能与结果记录

使用 [PRD 测量基线](02-product-requirements.md)：至少 30 次启动/搜索样本、指定资源和网络，记录 p95 与失败率。队列操作用 Performance API/浏览器 trace 测量；长任务与内存泄漏检查围绕真实播放和列表操作。

建议记录格式：日期、版本/commit、环境、样本规模与格式、操作、预期、实际、证据、问题 ID、是否复测。未具备的设备或服务能力写“未测/不支持”，不混同“通过”。

## 文档维护规则

产品范围变化更新 PRD；协议字段变化更新 API；播放器行为变化同步设计与测试；实际命令变化更新 README。本机服务配置和账号仍由用户管理，规划文档不替代已部署的配置。

# Tooku 服务端用户数据

更新日期：2026-10-24。此文描述当前实现，替代早期文档中“尚无后端”的描述。

## 当前存储方式

账号数据以服务器 SQLite 为主，浏览器保留离线缓存、未提交变更与设备显示偏好。设置日常显示保存状态、统一导出/恢复；仅迁移冲突、409 或未知写入核实后展示版本选择。原有 localStorage/IndexedDB、identity 和 v1 账号文档保持兼容，不清空旧数据。

## 数据与身份

Tooku 后端使用 Node.js 24 的 `node:http` / `node:sqlite`，没有新增 npm 依赖。音乐文件、歌曲元信息、收藏、歌单名称/简介/曲序继续由 Navidrome 管理。Tooku SQLite 保存一个版本化账号文档，包含头像、歌单自定义封面、歌手自定义图片、目录与排序、曲库视图、外观/歌词/布局偏好、最后保存的队列和最多 200 条历史。

客户端先通过同源 `/api/tooku/connection` 提交规范化登录地址。当前 Tooku 站点、旧 `/nd`、正式 `/api/navidrome` 以及与 `NAVIDROME_UPSTREAM` 匹配的真实地址继续直接映射默认上游；其他地址由后端解析并固定 DNS 结果、匿名请求 Navidrome ping，成功后签发十分钟随机连接票据。票据仅可访问登录前需要的 ping、扩展检测和原生登录，不接受逐请求目标，也不能调用其他协议方法。登录页服务器地址首次留空，以后回填此浏览器上次成功登录的安全地址；浏览器 `MusicApi.identity` 仍按规范化后的输入地址生成，因此已有 localStorage/IndexedDB 身份不改名。恢复会话会取回原输入地址；旧会话未保存地址时按原 `/nd` 身份恢复。「测试连接」只取得票据并匿名 ping，不创建账号会话或同步数据。

创建持久会话时，后端用票据中固定的目标再次验证 Subsonic token/salt，调用 `getUser` 并检查 HTTP 与业务状态；规范用户名来自已认证的上游响应。验证成功后，目标与认证材料一起加密保存在会话中，普通 API、封面和临时播放授权均只从会话读取目标。数据库 owner 是 `[规范化上游地址, 规范用户名]` 的 SHA-256，同名账号在不同服务器之间隔离；固定上游沿用原 owner 算法，不迁移或清空已有数据。浏览器继续使用原输入地址作为本地 identity，首次出现真实数据差异时沿用冲突保护。

登记地址默认只允许公网 HTTP(S)。设置 `TOOKU_ALLOW_PRIVATE_NAVIDROME=true` 后允许私网、回环和 Docker 内网目标，供可信自托管环境使用；固定 `NAVIDROME_UPSTREAM` 始终允许。链路本地、组播、未指定地址和已知云元数据地址即使打开私网开关也拒绝。每次代理连接重新解析域名，若任一结果落入禁止范围则拒绝，并把实际 socket 固定到检查过的地址，避免检查后再次解析造成 DNS 重绑定；上游重定向不跟随。连接探测与会话创建分别按来源地址限流。

受管上游登录会创建最长 30 天的随机 Cookie 会话：HttpOnly、SameSite=Strict、Path=/；HTTPS 登录及 `TOOKU_COOKIE_SECURE=true` 时使用 Secure。可信反向代理可配置 `TOOKU_TRUST_PROXY=true`，再根据单值 `X-Forwarded-Proto: https` 判断 HTTPS；逗号链、客户端伪造的 Forwarded/Host 信息不参与判断，不要在不可信入口启用此选项。最终入口确认全站 HTTPS 后可设置 `TOOKU_HSTS=true`，只在可信 HTTPS 请求发送 `Strict-Transport-Security: max-age=31536000`。数据库只保存会话令牌的 SHA-256 摘要。上游 token/salt、可选原生 JWT 在独立安全库中加密保存，密码始终不保存。页面启动先 GET session 重新验证会话绑定的上游，再读取账号数据并暂停恢复队列；退出先保存未提交变更，再由服务器撤销当前 Cookie 会话。普通已登录请求最多每 15 分钟重新验证一次上游；明确认证失效立即撤销，网络错误保留原记录。后端重启可恢复会话；过期、认证撤销或退出后需要重新登录。

`server/navidromeProxy.ts` 为白名单请求注入会话对应的认证与目标，前端媒体 URL 不包含 token/salt。普通代理关闭 stream/download 方法；受管播放器 POST `/api/tooku/playback` 后取得 256 位随机路径，服务端只保存摘要，并绑定当前 Cookie 会话摘要、owner、歌曲 ID、原始/兼容模式和最长四小时有效期。开始新授权、重新登录、明确认证撤销、退出或服务关闭会撤销旧授权并终止活动上游请求；每个授权最多 64 次请求、3 路并发，只接受 GET/HEAD 和单段 Range。暂停后若授权将在五分钟内到期，恢复时重新申请并从当前秒数继续。流响应移除重定向、上游 Cookie、附件文件名和服务指纹，固定 inline、private/no-store、same-origin；`deploy/default.conf.template` 对授权路径关闭访问日志。代理在请求侧移除 Cookie、Authorization、Forwarded/X-Forwarded-*、Tooku 内部身份头及逐跳头，在响应侧移除上游 Cookie、服务指纹和逐跳头；保留播放所需的 Range/Content-Range。原生登录只接受不超过 64 KiB 的 JSON，歌手图片只接受带 boundary、正文不超过 2 MiB 加封装余量的 multipart。账号数据请求绑定已验证 owner；媒体请求同时绑定当前登录名与 owner 摘要，同用户名的另一服务器覆盖 Cookie 后，旧标签页也会被拒绝。登录、连接探测和创建会话有限流、同源和超时检查；保留旧内存 Bearer 会话接口供兼容使用（12 小时，不持久化）。无法通过地址策略或协议验证的地址不会登记为受管连接；前端仍可按原直连路径尝试，受浏览器 CORS 与本地存储边界限制。已登记地址的认证材料只进入独立加密安全库，不开放任意代理。临时授权降低扩展自动接管和批量枚举，不构成 DRM。

生产 Node 入口统一发送 CSP、`frame-ancestors 'none'`、X-Frame-Options、Permissions-Policy、no-referrer 与 nosniff。CSP 允许同源应用资源、data/blob 图片、blob 媒体，以及 HTTP(S) Navidrome 的 API、图片和音频；禁止对象、跨源表单、页面嵌入和非本站脚本。新增或调整图片、音频、Worker、画中画及外部连接入口时，应先更新共享 `server/security.ts` 并执行安全头回归，不能在页面局部绕过。

## 首次迁移与日常保存

音乐推荐使用 v1 可选字段 `recommendations`，保存普通配置、最近一批最少歌曲元数据和有限避重记录（最多 300 个 ID、90 首 ID/标题/歌手）。可选推荐数量缺省按 30；旧版无这些字段的文档仍可读，不清空数据。API Key、模型密钥、Apple Developer Token 与 Spotify Client Secret 在独立安全库按账号加密保存，不进入账号文档、同步缓存或账号备份；Spotify 临时令牌仍仅进程内存；目录链接仅短时缓存，推荐不请求封面。恢复旧备份重置当前账号推荐配置与结果，不改其他账号和当前播放，无数据库 schema 升级。边界见 [音乐推荐](16-music-recommendations.md)。

批次歌曲可选 `releaseDate` 仅保存经目录核实的发行日期，保留年/月/日精度；旧歌曲无该字段仍可读。进入推荐页后分组核实整批链接时补齐的元数据仅在短时查询缓存，不自动改写已保存批次；点击菜单不再单独发起核实。

1. 在原浏览器使用原来成功登录的地址（包括固定上游真实地址或旧 `/nd`）登录；服务器没有个性数据时，先保留迁移前副本，再自动上传该身份已有数据。
2. 在另一浏览器通过同一 Tooku 服务登录同一固定上游账号；本地没有个性数据时自动恢复头像、歌单排序及其他账号数据，无需手动确认迁移。
3. 日常设置不展示两端比较。两边都有不同个性数据，或之前有待核实的保存结果时，才在头像 → 账户与设置 → 用户数据中比较：“保存到服务器”使用此浏览器的数据覆盖服务器；“从服务器恢复”使用服务器数据替换此浏览器。点击后先显示数据摘要和覆盖范围，确认后才执行。
4. 迁移/恢复前在 IndexedDB 保留一份 `before-import` 副本；原 localStorage 命名空间不删除。设置只有一个导出入口：正常连接时先保存待提交变更，再导出服务器账号文档；离线或冲突时保留此设备数据的可导出能力，并显示状态。统一从文件恢复，也可恢复服务器上一版本或导入前副本。

自动发现的默认库 ID、空队列和设备回退外观不视为账号编辑。完全空白的浏览器只建立同步连接，直到有实际用户数据才写入，避免默认状态抢先占据服务器。已同步浏览器主动删除头像等变更按其同步基线识别，不能当作新浏览器而撤销删除。

自动保存合并短时间内的变更；单文档 revision 使用 SQLite `BEGIN IMMEDIATE` 原子比较并递增。HTTP 409 后停止写入，点击重新连接读取，再选择版本；采用整个文档选择，不做字段级自动合并。超时后的写入结果视为未知，只读回核实，不自动重放。同步基线与 `requiresReview` 标志保留在本地，刷新不能绕过冲突或未知结果保护；旧版只有手动迁移标志的缓存，可在服务器仍为空时自动完成迁移。

断网时继续使用原浏览器存储；未上传修改保存在 sync 缓存。恢复连接后比较本地修改与服务器版本。偏好保留一份设备回退，账号偏好另存在其 sync 缓存，退出/切换账号还原设备回退，避免新账号继承上个账号的外观。

队列与历史是最后保存的账号快照，保留重复歌曲的 entryId / occurrenceId，不是跨设备播放控制或历史自动合并。另一个设备有更新时，下次登录读取；正在使用的设备仅在下一次保存碰到 revision 差异时提示冲突。恢复时不调用 player.attach，不加载/暂停/定位当前音频；快照用于下次登录暂停恢复。明确恢复后，本次登录暂停 queue/history 写入（包括暂停、周期保存、收听提交），保留当前音频和画面，恢复快照在下次登录应用。其他偏好仍正常保存。手动清除“本机快照”仅清浏览器 queue/history，保留迁移基线和服务器数据，服务器快照下次登录可能恢复。

## 存储、限制与迁移

默认 `.local/data/tooku.sqlite`，`TOOKU_DATA_DIR` 可改变目录。SQLite 开启 WAL / FULL synchronous；`PRAGMA user_version=1` 管理数据库迁移，文档 `version=1` 管理数据格式。遇到未知版本拒绝启动/导入，不能清库降级。新版本需要编写保留原数据的迁移。

图片继续使用应用裁剪后的 PNG/JPEG/WebP data URL，**与元数据一起事务保存在 SQLite**，没有独立图片目录。每张最多 2 MB 编码文本、账号当前文档最多 12 MB，队列最多 5000 项、目录最多 2000 个。用共享白名单验证嵌套字段、媒体 ID、目录循环/跨库关系，拒绝任意 URL、未知字段与非法图像格式。替换图片随文档替换，无孤立图片文件。服务器仅保留最近两个旧文档（包含图片），逻辑容量最多三个受限版本；SQLite/WAL 的实际磁盘空间可能更大，管理员需要监控磁盘容量。频繁播放保存也会推进旧版本，重要恢复点应导出备份到独立位置。

2026-10-20 为 v1 文档的 `profile` 增加可选 `artistCovers`，内容为歌手 ID 到裁剪后图片 data URL 的映射。旧数据/旧备份省略该字段仍可读取，语义等同空映射；没有自定义歌手图时导出仍省略字段，避免旧同步基线因空字段变化产生冲突。恢复旧备份会清除当前账号的自定义歌手图，不影响其他账号。此为 JSON 文档的兼容扩展，无 SQLite 表结构迁移；使用新字段需前后端一起更新。图片参与原有 revision、12 MB 总量、单图 2 MB、离线回退和备份恢复规则，不保存媒体认证 URL，该字段仍用于兼容旧版私人图片。新上传的歌手图片改为通过管理员原生 API 直接保存到 Navidrome，不再写入此映射；已有图片不自动上传，成功上传/读回后仅清除对应歌手的旧覆盖。

同日为 v1 文档的 `organization` 增加可选 `collapsedFolders`，仅存折叠的文件夹 ID，沿用账号隔离与文件夹自身的曲库归属；默认全部展开，不新增空字段以免改变旧同步基线。白名单验证最多 2000 个唯一 ID，且必须引用当前文档已有文件夹。展开全部时省略字段，删除文件夹时清理其 ID。旧浏览器数据与旧备份无需清理或迁移，省略该字段代表全部展开；恢复旧备份仅重置当前账号的折叠状态，其他账号不受影响。该兼容扩展无需 SQLite 表迁移，前后端需一起更新，并复用既有 revision、浏览器缓存、离线回退、导出/恢复与冲突选择；同步不干预当前音频。

同日为 v1 队列快照增加可选 `entries[].source`（`kind`、实体 `id`、可选 `libraryId`），以及 `shuffle` / `originalOrder`。来源仅为 album/playlist/artist/collection 和无认证信息的 ID；`originalOrder` 必须且仅能包含当前队列全部唯一 entryId，不以歌曲 ID 去重。它们跟随原有 IndexedDB、账号 SQLite 文档、导出/恢复与 revision 检查。旧数据省略字段时按无来源、顺序模式恢复，不推断旧歌单、不清理数据；新字段需前后端一起更新，无 SQLite 表迁移。恢复/同步仅保存快照，仍不加载或接管当前音频；下次登录保持暂停，手动关闭随机可恢复原顺序。

2026-10-22 为 v1 队列项增加可选 `sourceIndex`，记录来源列表的零基序号（非负整数，最多 1e9，必须伴随有效 `source`）。完整列表入队自动标记，单曲追加传原序号，未知位置省略；随机播放、队列调序、保存和重新登录均保留该值。用于底栏来源跳转定位重复歌曲，不是新的曲目身份，也不替代 `entryId`。旧快照和备份可继续读取，缺失时按歌曲查找；无数据库表迁移、无数据清理，前后端须一起更新。来源歌单被编辑后仅能按剩余曲目就近定位，不能保证追踪 Navidrome 没有提供身份的重复项。

## 会话与服务密钥的独立安全库

新增 `tooku-security.sqlite`，与账号文档数据库同目录，由 `server/vault.ts` 管理独立 schema v1。会话和各账号服务密钥使用 AES-256-GCM，每条记录独立随机 nonce，AAD 绑定账号/会话摘要及用途；密钥写入使用独立原子 revision，409 和结果未知后需重新读取状态，不能自动重放。前端 GET 只返回五个字段的保存布尔值和版本，不返回密钥。输入替换已有值，明确删除操作可清空已保存密钥。普通数据恢复不覆盖凭据。

32 字节随机主密钥默认保存在 `tooku-secret.key`，可用进程环境变量 `TOOKU_SECRET_KEY_FILE` 指向独立挂载的密钥文件；不把密钥内容放环境变量、源码或命令行。新数据目录首次生成，权限为当前服务用户可读写（POSIX 0600/目录 0700；Windows 需由管理员限制目录 ACL）。安全库已有记录时若主密钥缺失或错误，拒绝打开，不重新生成并覆盖原数据。磁盘加密用于隔离数据库备份泄漏，不能防御同时取得主密钥或控制服务进程的攻击者。应独立备份主密钥、限制服务目录权限并使用 HTTPS。

实现参考 [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) 与 [Cryptographic Storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)。未引入第三方认证或加密依赖，使用 Node 内置 crypto。

## API 与实现入口

v1 文档新增可选 `lyrics`，保存网络开关、来源顺序与按歌来源/绑定/排版/hash/延迟/显示选项，最多 2000 首；不保存歌词全文或凭据。字段缺省为默认策略，首次使用前不新增空字段改变同步基线。其校验、原子 revision、离线 sync 缓存和备份沿用现有通路；恢复旧备份会清除当前账号新增的歌词选择，其他账号保留，不接管音频。旧文档仍有效，无用户 SQLite 表迁移，新字段需前后端一起更新。

公开歌词保存在独立 `.local/data/lyrics-cache.sqlite`（也遵循 `TOOKU_DATA_DIR`），缓存上限约 100 MB / 5000 条，故障降级内存；不与 `tooku.sqlite` 共用表，也不推进账号 revision。账号 JSON / 用户库备份包含个人选择，不包含可重建平台缓存；恢复时无须复制或清除缓存。详见 [歌词组件](15-lyrics-service-design.md)。

用户数据 API 位于 `/api/tooku/`，不缓存。`health`、`connection` 和创建 session 无需账号会话，其余接口使用已验证的 HttpOnly Cookie（兼容旧内存 `Authorization: Bearer …`）；服务器由会话决定 owner，忽略客户端伪造 owner。`connection` 验证候选服务并可返回短时随机票据，不返回解析地址，也不代表账号认证。独立歌词 API `/api/lyrics/` 不使用账号认证。推荐 `/api/recommendations/` 使用已保存密钥时验证同一会话及当前账号，仅用请求草稿时保留同源、限流与固定来源规则；公开部署需外层访问控制。同源检查不等于账号授权，详见 [歌词组件](15-lyrics-service-design.md) 和 [音乐推荐](16-music-recommendations.md)。推荐目录/Spotify 临时令牌只在受限进程内存中复用，与歌词公共 SQLite 缓存不同，均不进入账号备份。

| 路径 | 方法 | 用途 |
| --- | --- | --- |
| `health` | GET | `{ app: 'tooku', persistence: 1 }` |
| `connection` | POST | 识别默认上游，或验证候选 Navidrome 并返回 `managed` 与可选十分钟连接票据 |
| `session` | POST / GET / DELETE | 验证并创建 Cookie 会话 / 恢复且重新验证 / 注销会话 |
| `playback` | POST | 为当前会话、歌曲和转码模式签发随机短时播放路径 |
| `credentials` | GET / PUT | 仅读保存状态与 revision / 按版本更新密钥字段；不返回密钥 |
| `data` | GET / PUT | 读取文档 / 提交 `{ revision, data }`；不匹配返回 409 |
| `backup` | GET | 当前账号可携带图片的版本化 JSON |
| `revisions` | GET | 当前账号最近两个旧文档，恢复同样使用 revision 检查 |

实际二进制流位于 `/api/tooku-stream/{grant}`，不属于账号 JSON API；只接受 GET/HEAD，外层代理必须转发 Range 并避免记录完整路径。

`server/api.ts` 负责认证、同源、请求上限与错误脱敏；`server/vault.ts` 管理会话摘要和加密凭据；`src/features/session/restoreSession.ts` 管理首次恢复；`server/store.ts` 负责 SQLite 及原子版本检查；`src/domain/userData.ts` 是共享格式与校验；`src/api/client.ts` / `userData.ts` 负责客户端连接；`src/storage/userSync.ts` 连接旧 store / IndexedDB；`UserDataSettings.tsx` 负责预览和恢复。不会创建第二套播放器或 QueryClient。

## 受管多服务器的当前边界与后续工作

第一阶段已允许登录页接受服务端可达、策略允许且验证成功的 Navidrome HTTP(S) 地址，并让它获得与固定上游相同的持久登录、账号数据、服务密钥、备份和临时播放授权。它没有把客户端地址直接拼到通用代理请求中；短时票据与加密会话固定目标，后续音乐代理从会话取目标，单次请求不能改写。

仍需继续完成稳定服务器 ID 与同地址别名合并、服务器列表/改址/删除管理，以及一个浏览器中多个服务器同时保持独立 Cookie 会话。当前单个浏览器 origin 仍只有一个登录 Cookie；新标签页切换服务器会使旧标签页请求因 owner 不匹配而失败，不会串到同用户名的另一服务器。私网开关目前是部署级布尔策略，后续可增加明确主机/CIDR 允许列表。`NAVIDROME_UPSTREAM` 继续作为默认服务器和旧 `/nd` 兼容入口。

## 运行与部署

开发启动仍是 `npm.cmd run dev` / `start-tooku.cmd`，Vite 同一端口挂载业务 API 与固定上游代理。健康接口 `/__tooku/health` 的 `persistence: 1` 可区分新版；旧进程需要在方便时重启，不应为升级终止用户播放。

生产：先 `npm.cmd run build`，再 `npm.cmd start`；Node 运行时直接执行可擦除 TypeScript，无需生产 node_modules。默认监听 `127.0.0.1:18733`，可设 `TOOKU_HOST` / `TOOKU_PORT`。默认 Navidrome 上游仍为 `http://127.0.0.1:44533`，配置可含子路径，不含认证信息、query 或 hash。

Compose 使用明确的 UID/GID 1000 运行 Node，持久化卷 `tooku-data:/data` 保存数据库，独立卷 `tooku-security-key:/run/tooku-secret` 保存主密钥，仅向本机暴露 8080。根文件系统只读，只有数据卷、密钥卷和受限 `/tmp` 可写；容器不保留 Linux capabilities，并启用 no-new-privileges、PID/内存/CPU 限制和健康检查。不要执行 `docker compose down -v` 作为升级步骤，它会删除两个卷。宿主机、同一 Compose 网络和远程 HTTPS 上游的配置，以及完整备份/回滚步骤见 [容器部署](../deploy/README.md)。本开发机没有容器运行时，构建、挂载权限、卷恢复和宿主机上游连通性仍需在 Docker 环境实际验证。

外层 HTTPS 反向代理应将整个 Tooku 站点转发到同一个 Node 服务，并保留客户端 Host。参考 `deploy/default.conf.template`。不记录 Authorization、POST body 或完整查询字符串；原生 Node 服务不输出访问详情。远程访问应在外层提供 HTTPS。静态文件单独托管或 `vite preview` 不提供业务 API，应使用 Node 生产入口。

## 备份与恢复

账号备份：设置中的统一导出会生成 `tooku-user-data` v1 JSON，包含头像和封面，没有密码/token/salt。恢复时先检查格式、大小和 owner，只能导入当前固定上游的同一规范账号，然后预览并确认。备份包含个人数据，应保存在自己控制的位置。浏览器缓存和服务端两个旧版本不能替代外部备份。

账号数据库备份：`npm.cmd run backup -- .local/backups/tooku-2026-10-20.sqlite`，目标文件必须不存在。使用 SQLite 在线 backup API，包含 WAL 中已提交事务，不能只复制一个仍在写入的 `.sqlite` 文件。Node 原生 API 参见 [SQLite 文档](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)。容器可执行 `docker compose exec tooku node server/backup.ts /data/backup.sqlite`，再用 `docker compose cp tooku:/data/backup.sqlite ./backup.sqlite` 复制到独立位置；下一份备份使用不同文件名。

账号数据库恢复：停止目标 Tooku 服务，先将原数据库及同名 `-wal` / `-shm` 文件整体移动到保留目录，再把备份复制为数据目录中的 `tooku.sqlite`，保留原文件权限及固定上游配置，然后启动并登录核实。不能在旧 WAL 尚在原路径时直接覆盖主数据库。恢复整个数据库会恢复所有账号的文档及旧版本，登录会话和服务密钥不随账号数据库恢复。

完整部署迁移还需单独保留 `tooku-security.sqlite` 及原 `tooku-secret.key` / 外部密钥文件。先正常停止服务，再保留安全库及其 WAL/SHM 和密钥，不能只复制仍在写入的安全库主文件。主密钥与安全库应分别保管；账号导出/`npm run backup` 不包含它们。若无需保留会话和密钥，可只迁移账号数据库，重新登录并填写服务密钥；不能删除现有安全库或生成新主密钥作为已有库的修复步骤。

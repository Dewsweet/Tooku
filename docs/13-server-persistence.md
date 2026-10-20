# Tooku 服务端用户数据

更新日期：2026-10-20。此文描述当前实现，替代早期文档中“尚无后端”的描述。

## 数据与身份

Tooku 后端使用 Node.js 24 的 `node:http` / `node:sqlite`，没有新增 npm 依赖。音乐文件、歌曲元信息、收藏、歌单名称/简介/曲序继续由 Navidrome 管理。Tooku SQLite 保存一个版本化账号文档，包含头像、歌单自定义封面、歌手自定义图片、目录与排序、曲库视图、外观/歌词/布局偏好、最后保存的队列和最多 200 条历史。

客户端只对同源 `/nd` 建立同步。后端只验证 `NAVIDROME_UPSTREAM` 配置的固定地址，不访问客户端提供的 URL。认证时将当前会话的 Subsonic token/salt 放在 POST 表单中，调用 `getUser` 并检查 HTTP 与业务状态；规范用户名来自已认证的上游响应。数据库 owner 是 `[规范化固定上游地址, 规范用户名]` 的 SHA-256。修改部署上游地址会改变命名空间，迁移部署时应保留该地址配置。浏览器 `MusicApi.identity` 保持旧规则以找到旧数据；跨 origin 的同一后端账号仍访问相同服务端记录。

Tooku 随机会话令牌只在内存保存，12 小时过期；退出时销毁，后端重启后需重新连接。认证材料不写数据库/配置/日志，也不保存认证媒体 URL。会话建立有限流与上游超时，不支持跨域访问。账号权限撤销在会话到期或重新验证时生效。完整地址直连继续可用，但不参与 Tooku 同步，以免错误归入固定上游账号。

## 首次迁移与日常保存

1. 在原浏览器与原访问 origin，通过 `/nd` 登录；服务器没有个性数据时，先保留迁移前副本，再自动上传此设备已有数据。
2. 在另一浏览器通过同一 Tooku 服务的 `/nd` 登录，使用同一账号；本地没有个性数据时自动恢复头像、歌单排序及其他账号数据，无需手动确认迁移。
3. 两边都有不同个性数据，或之前有待核实的保存结果时，才在头像 → 账户与设置 → 用户数据中比较并选择“预览导入”或“预览使用”。
4. 迁移/恢复前在 IndexedDB 保留一份 `before-import` 副本；原 localStorage 命名空间不删除。设置可导出本地/服务端账号备份，也可恢复导入前副本。

自动发现的默认库 ID、空队列和设备回退外观不视为账号编辑。完全空白的浏览器只建立同步连接，直到有实际用户数据才写入，避免默认状态抢先占据服务器。已同步浏览器主动删除头像等变更按其同步基线识别，不能当作新浏览器而撤销删除。

自动保存合并短时间内的变更；单文档 revision 使用 SQLite `BEGIN IMMEDIATE` 原子比较并递增。HTTP 409 后停止写入，点击重新连接读取，再选择版本；采用整个文档选择，不做字段级自动合并。超时后的写入结果视为未知，只读回核实，不自动重放。同步基线与 `requiresReview` 标志保留在本地，刷新不能绕过冲突或未知结果保护；旧版只有手动迁移标志的缓存，可在服务器仍为空时自动完成迁移。

断网时继续使用原浏览器存储；未上传修改保存在 sync 缓存。恢复连接后比较本地修改与服务器版本。偏好保留一份设备回退，账号偏好另存在其 sync 缓存，退出/切换账号还原设备回退，避免新账号继承上个账号的外观。

队列与历史是最后保存的账号快照，保留重复歌曲的 entryId / occurrenceId，不是跨设备播放控制或历史自动合并。另一个设备有更新时，下次登录读取；正在使用的设备仅在下一次保存碰到 revision 差异时提示冲突。恢复时不调用 player.attach，不加载/暂停/定位当前音频；快照用于下次登录暂停恢复。继续本机播放会再次保存其当前快照。手动清除“本机快照”仅清浏览器 queue/history，保留迁移基线和服务器数据，服务器快照下次登录可能恢复。

## 存储、限制与迁移

默认 `.local/data/tooku.sqlite`，`TOOKU_DATA_DIR` 可改变目录。SQLite 开启 WAL / FULL synchronous；`PRAGMA user_version=1` 管理数据库迁移，文档 `version=1` 管理数据格式。遇到未知版本拒绝启动/导入，不能清库降级。新版本需要编写保留原数据的迁移。

图片继续使用应用裁剪后的 PNG/JPEG/WebP data URL，**与元数据一起事务保存在 SQLite**，没有独立图片目录。每张最多 2 MB 编码文本、账号当前文档最多 12 MB，队列最多 5000 项、目录最多 2000 个。用共享白名单验证嵌套字段、媒体 ID、目录循环/跨库关系，拒绝任意 URL、未知字段与非法图像格式。替换图片随文档替换，无孤立图片文件。服务器仅保留最近两个旧文档（包含图片），逻辑容量最多三个受限版本；SQLite/WAL 的实际磁盘空间可能更大，管理员需要监控磁盘容量。频繁播放保存也会推进旧版本，重要恢复点应导出备份到独立位置。

2026-10-20 为 v1 文档的 `profile` 增加可选 `artistCovers`，内容为歌手 ID 到裁剪后图片 data URL 的映射。旧数据/旧备份省略该字段仍可读取，语义等同空映射；没有自定义歌手图时导出仍省略字段，避免旧同步基线因空字段变化产生冲突。恢复旧备份会清除当前账号的自定义歌手图，不影响其他账号。此为 JSON 文档的兼容扩展，无 SQLite 表结构迁移；使用新字段需前后端一起更新。图片参与原有 revision、12 MB 总量、单图 2 MB、离线回退和备份恢复规则，不保存媒体认证 URL，该字段仍用于兼容旧版私人图片。新上传的歌手图片改为通过管理员原生 API 直接保存到 Navidrome，不再写入此映射；已有图片不自动上传，成功上传/读回后仅清除对应歌手的旧覆盖。

同日为 v1 文档的 `organization` 增加可选 `collapsedFolders`，仅存折叠的文件夹 ID，沿用账号隔离与文件夹自身的曲库归属；默认全部展开，不新增空字段以免改变旧同步基线。白名单验证最多 2000 个唯一 ID，且必须引用当前文档已有文件夹。展开全部时省略字段，删除文件夹时清理其 ID。旧浏览器数据与旧备份无需清理或迁移，省略该字段代表全部展开；恢复旧备份仅重置当前账号的折叠状态，其他账号不受影响。该兼容扩展无需 SQLite 表迁移，前后端需一起更新，并复用既有 revision、浏览器缓存、离线回退、导出/恢复与冲突选择；同步不干预当前音频。

同日为 v1 队列快照增加可选 `entries[].source`（`kind`、实体 `id`、可选 `libraryId`），以及 `shuffle` / `originalOrder`。来源仅为 album/playlist/artist/collection 和无认证信息的 ID；`originalOrder` 必须且仅能包含当前队列全部唯一 entryId，不以歌曲 ID 去重。它们跟随原有 IndexedDB、账号 SQLite 文档、导出/恢复与 revision 检查。旧数据省略字段时按无来源、顺序模式恢复，不推断旧歌单、不清理数据；新字段需前后端一起更新，无 SQLite 表迁移。恢复/同步仅保存快照，仍不加载或接管当前音频；下次登录保持暂停，手动关闭随机可恢复原顺序。

## API 与实现入口

v1 文档新增可选 `lyrics`，保存网络开关、来源顺序与按歌来源/绑定/排版/hash/延迟/显示选项，最多 2000 首；不保存歌词全文或凭据。字段缺省为默认策略，首次使用前不新增空字段改变同步基线。其校验、原子 revision、离线 sync 缓存和备份沿用现有通路；恢复旧备份会清除当前账号新增的歌词选择，其他账号保留，不接管音频。旧文档仍有效，无用户 SQLite 表迁移，新字段需前后端一起更新。

公开歌词保存在独立 `.local/data/lyrics-cache.sqlite`（也遵循 `TOOKU_DATA_DIR`），缓存上限约 100 MB / 5000 条，故障降级内存；不与 `tooku.sqlite` 共用表，也不推进账号 revision。账号 JSON / 用户库备份包含个人选择，不包含可重建平台缓存；恢复时无须复制或清除缓存。详见 [歌词组件](15-lyrics-service-design.md)。

用户数据 API 位于 `/api/tooku/`，不缓存。除 health 和创建 session 外，必须提供内存中的 `Authorization: Bearer …`；服务器由会话决定 owner，忽略客户端伪造 owner。独立公开歌词 API 位于 `/api/lyrics/`，不使用该账号认证，详见 [歌词组件](15-lyrics-service-design.md)。

| 路径 | 方法 | 用途 |
| --- | --- | --- |
| `health` | GET | `{ app: 'tooku', persistence: 1 }` |
| `session` | POST / DELETE | 验证上游并创建会话 / 注销会话 |
| `data` | GET / PUT | 读取文档 / 提交 `{ revision, data }`；不匹配返回 409 |
| `backup` | GET | 当前账号可携带图片的版本化 JSON |
| `revisions` | GET | 当前账号最近两个旧文档，恢复同样使用 revision 检查 |

`server/api.ts` 负责认证、同源、请求上限与错误脱敏；`server/store.ts` 负责 SQLite 及原子版本检查；`src/domain/userData.ts` 是共享格式与校验；`src/api/client.ts` / `userData.ts` 负责客户端连接；`src/storage/userSync.ts` 连接旧 store / IndexedDB；`UserDataSettings.tsx` 负责预览和恢复。不会创建第二套播放器或 QueryClient。

## 运行与部署

开发启动仍是 `npm.cmd run dev` / `start-tooku.cmd`，Vite 同一端口挂载业务 API 与固定上游代理。健康接口 `/__tooku/health` 的 `persistence: 1` 可区分新版；旧进程需要在方便时重启，不应为升级终止用户播放。

生产：先 `npm.cmd run build`，再 `npm.cmd start`；Node 运行时直接执行可擦除 TypeScript，无需生产 node_modules。默认监听 `127.0.0.1:18733`，可设 `TOOKU_HOST` / `TOOKU_PORT`。默认 Navidrome 上游仍为 `http://127.0.0.1:44533`，配置可含子路径，不含认证信息、query 或 hash。

Compose 使用 Node 非 root 用户运行，持久化卷 `tooku-data:/data`，仅向本机暴露 8080。不要执行 `docker compose down -v` 作为升级步骤，它会删除卷。容器构建/挂载权限/宿主机上游连通性仍需部署环境实际验证。

外层 HTTPS 反向代理应将整个 Tooku 站点转发到同一个 Node 服务，并保留客户端 Host。参考 `deploy/default.conf.template`。不记录 Authorization、POST body 或完整查询字符串；原生 Node 服务不输出访问详情。远程访问应在外层提供 HTTPS。静态文件单独托管或 `vite preview` 不提供业务 API，应使用 Node 生产入口。

## 备份与恢复

账号备份：设置中的导出会生成 `tooku-user-data` v1 JSON，包含头像和封面，没有密码/token/salt。恢复时先检查格式、大小和 owner，只能导入当前固定上游的同一规范账号，然后预览并确认。备份包含个人数据，应保存在自己控制的位置。浏览器缓存和服务端两个旧版本不能替代外部备份。

完整备份：`npm.cmd run backup -- .local/backups/tooku-2026-10-20.sqlite`，目标文件必须不存在。使用 SQLite 在线 backup API，包含 WAL 中已提交事务，不能只复制一个仍在写入的 `.sqlite` 文件。Node 原生 API 参见 [SQLite 文档](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)。容器可执行 `docker compose exec tooku node server/backup.ts /data/backup.sqlite`，再用 `docker compose cp tooku:/data/backup.sqlite ./backup.sqlite` 复制到独立位置；下一份备份使用不同文件名。

完整恢复：停止目标 Tooku 服务，先将原数据库及同名 `-wal` / `-shm` 文件整体移动到保留目录，再把备份复制为数据目录中的 `tooku.sqlite`，保留原文件权限及固定上游配置，然后启动并登录核实。不能在旧 WAL 尚在原路径时直接覆盖主数据库。恢复整个数据库会恢复所有账号的文档及旧版本，登录会话仍需重新建立。

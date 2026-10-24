# Tooku 开发接入指南

更新日期：2026-10-23。面向首次接入本仓库的 Agent 和开发者，描述当前实现与查找入口。

根目录 [AGENTS.md](../AGENTS.md) 是开发约定入口；本指南提供模块地图、数据说明和常见改动路径。[开发记录](09-development-status.md) 汇总当前状态和带日期的验证证据；01–08、10–11 号文档保留调研、设计演进或发布矩阵，其中的示意目录、旧交互和排期不等于当前实现。持久化、歌词与推荐的当前细节分别见 13、15、16 号文档。

## 1. 五分钟接入

1. 阅读 [AGENTS.md](../AGENTS.md)，检查 `git status --short`，确认任务边界和已有改动。
2. 从下方模块表找到对应源码；读取相关测试，不必从头阅读所有历史文档。
3. 先读取 `.local/server-url.txt` 并检查 `/__tooku/health`，复用已有服务；确需启动时使用 `npm.cmd run dev` 或 `start-tooku.cmd`，默认 18733，Navidrome 默认 44533，不中断用户播放。
4. 有写入验证需求时优先使用隔离测试服务或授权的专用测试歌单；真实账号凭据只通过登录页输入。
5. 完成实现与必要的基础检查，按功能保存 Git 提交；人工功能和观感检查在回复中简列。

没有全局 pnpm 是受支持的环境。首次安装使用 `npx.cmd --yes pnpm@11.25.0 install --frozen-lockfile`，不混用包管理器。服务端使用内置 SQLite / TypeScript 执行，需要 Node 24.22.1+；`scripts/check-node-version.mjs` 是启动、构建、测试和备份的统一最低版本门槛，`.nvmrc` 与 Docker 镜像固定同一基线。服务端和共享运行时模块使用可擦除语法与显式 `.ts` / `.mjs` 相对导入；不要引入 enum、构造函数参数属性或仅靠打包器才能执行的代码。

手机局域网调试使用 `npm.cmd run dev:lan` 或 `./start-tooku.cmd --lan`，显式监听 `0.0.0.0`；普通启动仍监听 `127.0.0.1`。`scripts/network-listener.mjs` 负责复用范围判断和 IPv4 地址展示，启动状态记录 `host`，旧状态按仅本机兼容。发现健康的仅本机服务时，LAN 启动提示正常停止后重启，不自动结束进程或并行启动另一份数据服务；已开启 LAN 的服务可继续复用。手机选择终端中电脑 Wi-Fi 网卡对应的 `LAN` 地址，登录填写同一 Tooku 根地址即可走 `/api/navidrome`；实际端口以终端为准。保持 Vite 主机校验与 API 同源校验，不为联网调试修改 Navidrome、防火墙或持久化身份规则。

局域网 HTTP 页面可能缺少仅安全上下文开放的 `crypto.randomUUID()`。前端内部 ID 统一用 `src/domain/ids.ts` 的 `createId()`，以 `getRandomValues()` 生成 UUID v4 兼容，不能用 `Math.random()` 或改写全局 crypto；播放器模块初始化、播放次数、队列重复项和文件夹均使用该入口。已有 ID 不迁移、不重写。排查网络时先区分健康端点不可达和页面脚本白屏；防火墙规则类别必须与实际 WLAN 类别一致，读取规则不代表已经完成手机实测。

## 2. 当前架构

Tooku 0.1.0 是 SPA 与 Node.js / SQLite 用户数据服务，技术栈以 [package.json](../package.json) 为准：React、TypeScript、Vite、React Router、TanStack Query、Zustand、idb、Lucide React、Vitest 与 Testing Library。后端只用 Node 内置模块；未引入第二套 UI、状态或播放框架。

```text
React 页面 / 通用控件
  ├─ TanStack Query → MusicApi → /api/navidrome/rest → Navidrome
  ├─ useLyrics → TookuLyricsApi → /api/lyrics → 网易云 / QQ → 独立缓存
  ├─ 推荐页面 → RecommendationsApi → /api/recommendations → Last.fm / AI / 四平台目录
  ├─ player 命令 → 常驻 PlayerEngine → HTMLAudioElement
  ├─ Zustand / IndexedDB → 浏览器缓存、未上传修改与设备回退
  └─ userSync → /api/tooku → 已验证账号 → SQLite 用户文档
```

开发环境由 Vite 挂载业务 API，并通过 `/api/navidrome/rest` 转发协议请求及白名单内的原生登录/歌手图片接口；旧 `/nd` 路由仅保留兼容。生产 `server/index.ts` 同时提供静态页面、API 与代理，Docker 使用 Node 及持久化数据卷；生产先 build 再 `npm.cmd start`，`vite preview` 仅预览静态资源。登录服务器地址首次留空，成功后由 `src/storage/loginServer.ts` 保存安全的地址并在返回/刷新时回填；拒绝认证信息、查询、锚点及异常内容，浏览器存储不可用不阻断登录，不保存账号密码、不进入账号同步/备份。连接准备阶段把当前站点、旧 `/nd` 和固定 `NAVIDROME_UPSTREAM` 映射到默认上游；其他地址由后端验证 Navidrome 后签发短时连接票据，登录成功再固定到加密会话。浏览器 `identity` 继续采用规范化输入地址以读取旧 localStorage/IndexedDB，恢复会话也保存该地址。私网与回环登记需部署者显式设置 `TOOKU_ALLOW_PRIVATE_NAVIDROME=true`，固定上游始终兼容。服务端身份、版本与备份约定详见 [服务端持久化](13-server-persistence.md)。

生产浏览器安全头及 Origin/HTTPS 判断集中在 `server/security.ts`；API handler 复用 `sameOriginRequest`，不能各自重新解析不可信 Origin。受管上游转发的头清理、原生登录/图片正文边界和路径白名单集中在 `server/navidromeProxy.ts`，地址解析、私网策略与 DNS 固定集中在 `server/navidromeTarget.ts`。只有受控 HTTPS 反向代理可启用 `TOOKU_TRUST_PROXY=true`，HSTS 另需 `TOOKU_HSTS=true`；部署调整后回归 Secure Cookie、单值 X-Forwarded-Proto、CSP 对直连 Navidrome 音频/封面/API 和画中画歌词的影响。

登录页的 `testServerConnection` 集中在 `src/api/client.ts`：无账号参数和 Cookie 的 ping，校验音乐服务响应，认证要求也视为可达；使用单次无缓存 API 往返时间，不表示音频延迟或账号正确。8 秒超时，网络/HTTP/非音乐服务分别提示；修改地址与卸载取消请求并忽略迟到结果，不建立会话、同步数据或接入播放器。

`Login.tsx` 保持连接配置与凭据为两个独立 POST 表单，`username` / `password` 的 id/name 和标准 autocomplete 不随文案变更；服务器地址使用不含 login 字样的 `navidrome-server` 标识，关闭自动补全并加 `data-bwignore` 提示，继续支持旧 `/nd` 文本输入。提交以 FormData 和实际服务器输入值为准，兼容密码管理器未派发 React change 的填写，并在重绘前同步内存草稿；不新增凭据持久化。参考 [Bitwarden 字段识别说明](https://contributing.bitwarden.com/architecture/deep-dives/autofill/generating-fill-scripts/)，独立表单和明确的字段名是主要措施；[Bitwarden 当前源码](https://github.com/bitwarden/clients/blob/main/apps/browser/src/autofill/services/collect-autofill-content.service.ts) 中 `data-bwignore` 受用户选项控制，不应仅依赖它，也不使用隐藏诱饵或临时只读字段。真实扩展自动填写需人工验收。

受管上游登录后浏览器使用 HttpOnly Cookie，`features/session/restoreSession.ts` 在挂载工作区前恢复登录、用户数据和暂停队列。`server/vault.ts` 在独立安全库中加密存储目标、认证材料与服务密钥，`navidromeProxy.ts` 从当前 Cookie 会话读取目标并注入上游认证，前端 URL 不携带 token/salt。数据接口附已验证 owner，媒体和推荐请求附当前账号；新客户端的媒体请求也附 owner 摘要，避免同用户名的另一服务器覆盖 Cookie 后旧标签页串号。用户数据 `/api/tooku` 通过验证过的账号会话隔离；`/api/lyrics` 与 `/api/recommendations` 是同源限流服务；歌词不依赖登录，推荐使用保存密钥时必须验证当前 Tooku 会话，同源检查不等于账号授权。公开部署由外层入口控制访问，不能把它们改成任意代理。歌词的 SQLite 公共缓存与推荐的受限进程内存缓存均不进入账号备份。

## 3. 源码与修改入口

| 职责 | 文件 / 目录 | 开发注意点 |
| --- | --- | --- |
| Provider 与 CSS 入口 | `src/main.tsx` | Router 内有 `Interactions`，QueryClient 由 Provider 注入；保持 StrictMode 下的清理 |
| 路由、常驻布局、快捷键 | `src/App.tsx` | 切页不能重建音频；弹窗、输入和分隔条操作不应触发播放快捷键 |
| 头部、搜索、头像菜单 | `src/components/WorkspaceHeader.tsx` | 唯一账户设置入口、快速切库、搜索输入法组合与防抖 |
| 通用歌曲表格 | `src/components/Common.tsx` 的 `TrackList` | 收藏、右键动作、空白处双击、顺序与权限回调；不要另建一套表格交互 |
| 列宽 | `src/components/TrackColumns.tsx` | 歌单/专辑与推荐表头共用 `TrackColumnHandle` 和偏好；指针与键盘操作，预览宽度与提交偏好分离 |
| 右键菜单、图标提示 | `src/components/Interactions.tsx`、`useTooltips.ts`、`popover.ts` | `useContextMenu()`、`data-tooltip`；鼠标/键盘与触摸长按分离，安全浮层打开、定位翻转和焦点恢复 |
| 界面异常恢复 | `src/components/WorkspaceBoundary.tsx`、`src/main.tsx` | 边界包裹 Interactions/App，Router/Query Provider 与会话/播放单例留在外侧；恢复只重建 UI，不重新登录或接入音频 |
| 基础弹窗和选择器 | `src/components/Modal.tsx`、`Select.tsx` | 原生 dialog 与 popover；dismissRef 让移动手势复用同一关闭流程，不复制动画或焦点恢复 |
| 账户与设置 | `src/pages/Settings.tsx`、`src/features/settings/SettingsSection.tsx`、`settings.css` | 六类导航、统一设置分区/状态/操作；分类切换保留推荐草稿与检测，不重建音频 |
| 界面字体与设备字号 | `src/fonts.css`、`src/state/display.ts`、`src/assets/fonts/` | 两款思源原始 WOFF2 按需加载，也可选系统黑体/宋体；字体与字号不进入账号同步与备份 |
| 封面与头像 | `EntityArtwork.tsx`、`ProfileAvatar.tsx`、`AvatarEditor.tsx` | 歌单本地封面覆盖、加载失败回退；头像圆形预览，歌单与歌手图片方形预览 |
| 歌曲/歌手独立链接 | `src/components/TrackLinks.tsx` | 歌曲在底栏按播放来源跳转并定位，歌手跳歌手；不要把整组信息包成同一个链接 |
| 首页和搜索 | `src/pages/Home.tsx`、`Search.tsx` | 数据按当前曲库筛选，保留综合搜索分类和真实统计 |
| 收藏与内容筛选 | `src/pages/Collection.tsx`、`src/components/FilterPills.tsx` | 收藏/主页共用圆角胶囊筛选；收藏歌手复用 `ArtistGrid`；三类空状态仅显示“还没有收藏的歌曲/专辑/歌手” |
| 专辑与歌手页 | `src/pages/Library.tsx`、`ArtistDetail.tsx` | 专辑完整读取后显示；专辑/歌手每行数量，歌手横幅与专辑区，保留当前库边界 |
| 全站滚动条 | `src/components/ContentScrollbar.tsx`、`ScrollArea.tsx` | 中部、左栏和播放侧栏叠加贴边 8 px 滑块；监听滚动和内容尺寸，支持拖动、键盘及清理；弹窗/菜单使用 `src/scrollbars.css` 原生回退 |
| 浏览密度与播放操作 | `src/components/GridDensity.tsx`、`PlaybackButtons.tsx` | 复用列数选择及播放/随机操作；列数在 `state/display.ts` 按本机保存 |
| 播放来源定位 | `src/components/TrackLinks.tsx`、`useTrackLocation.ts`、`src/domain/playbackLocation.ts` | 底栏来源链接、重复项定位与主滚动区聚焦，不能调用音频命令 |
| 歌单管理与详情 | `src/features/library/PlaylistViews.tsx` | 直接排序保存、随机播放、只读判断；详情通过 key 隔离每张歌单的编辑状态 |
| 歌单信息与选图 | `src/features/library/PlaylistDetailsEditor.tsx`、`PlaylistCoverPicker.tsx` | 详情封面直达选图/裁剪，三点菜单编辑名称/简介；名称/简介写 Navidrome，封面沿用 Tooku 账号同步 |
| 新建歌单 | `src/features/library/CreatePlaylist.tsx` | 左栏可选位置；管理页使用当前目录 |
| 左栏树和移动弹窗 | `src/features/library/Organization.tsx` | 与管理页共用组织数据；`pages/Playlists.tsx` 保留导出和添加歌曲入口 |
| 左栏文件夹拖放 | `src/features/library/useOrganizationDrag.ts`、`src/state/library.ts` | 横线排序、变色移入文件夹、末尾横线移到根目录；主体管理页不参与拖放 |
| API 与统一模型 | `src/api/client.ts`、`src/domain/models.ts` | HTTP/业务错误分开，DTO 转换集中；不要照抄旧文档示意字段名 |
| 播放引擎与算法 | `src/features/player/engine.ts`、`src/domain/queue.ts` | 单实例媒体、异步竞争、队列条目身份与有效收听 |
| 底栏与完整播放器 | `src/features/player/PlayerUI.tsx`、`PlayerPages.tsx`、`player-pages.css` | UI 发命令，不创建音频；桌面左右布局，手机控制/歌词横向整屏切换，三点菜单集中歌曲操作 |
| 浏览器全屏 | `src/features/player/FullscreenButton.tsx` | 顶部/底栏复用；Fullscreen API 进入根节点、同步退出状态、重新提升原生弹窗，保持 DOM、查询与音频；不支持时禁用 |
| 桌面歌词 | `src/features/player/DesktopLyrics.tsx`、`desktop-lyrics.css` | 底栏按钮打开 Document Picture-in-Picture；Portal 共用歌词查询与状态，当前句原文/译文同步显示，静态歌词手动滚动；窗口位置由浏览器控制，保留用户拖动位置；关闭、切账号与迟到请求清理，不接管音频 |
| 播放侧栏 | `NowPlayingPanel.tsx`、`QueuePanel.tsx`、`MobileQueueSheet.tsx`、`PanelResizeHandle.tsx` | 完整队列覆盖在原侧栏内，关闭恢复；分栏拖动条由 App 放在面板间隙 |
| 歌词 | `src/features/player/Lyrics.tsx` | 独立滚动视口、按锚点对齐与首尾留白、空闲恢复和偏移换算 |
| 歌词来源与双语整理 | `src/features/lyrics/`、`src/domain/lyrics/`、`src/api/lyrics.ts` | 本地优先；来源/绑定/按歌修正共用，滚动状态独立；本地错误不触发自动补齐 |
| 网络歌词服务 | `server/lyrics/`、`NetworkLyricsSettings.tsx` | 同端口独立查询/检测、固定平台协议、受限缓存和真实观测；不依赖 Navidrome 会话 |
| 音乐推荐 | `src/features/recommendations/`、`RecommendationSettings.tsx`、`server/recommendations/`（含 `cache.ts` 受限内存缓存） | 左栏为你推荐与主页文字入口；Last.fm / AI 扩展及补量、多样性筛选、整批四平台外链核实；服务端按账号加密保存密钥，详见 [音乐推荐](16-music-recommendations.md) |
| 本机快照 | `src/storage/local.ts` | IndexedDB `tooku` / `profiles`；按身份分区的队列与历史 |
| 用户数据同步 | `src/storage/userSync.ts`、`src/features/settings/UserDataSettings.tsx` | 空端自动迁移/恢复、版本冲突、离线缓存、备份恢复；不得操作当前音频 |
| 后端与共享格式 | `server/api.ts`、`navidromeTarget.ts`、`store.ts`、`vault.ts`、`index.ts`、`src/domain/userData.ts` | 受管目标验证与会话绑定、SQLite 原子 revision、限额与白名单 |
| 启动与部署 | `scripts/dev-server.mjs`、`scripts/port-selection.mjs`、`start-tooku.cmd`、`deploy/` | 有界端口回退、健康检查与复用现有服务 |

新增功能优先扩展这些边界，不要求为了符合早期“目录建议”搬动整个仓库。已有文件包含较长 JSX，新代码优先写清晰的组件和函数；拆分只服务当前任务。

## 4. 当前 UI 契约

### 布局与入口

头部是全局导航；主体为左侧导航/歌单树、中部浏览区、右侧播放内容，底部为常驻控制栏。窄屏使用覆盖侧栏，避免把主体压成不可用宽度。

- 桌面主页图标左侧提供后退/前进，只遍历本次登录工作区已访问的页面；无可用历史时禁用，搜索替换不新增历史。主页图标只在当前主页显示选中效果，搜索栏尾部不显示回车图标。手机头部仅有导航、主页、搜索、头像，单行排列；不渲染 Logo、历史或侧栏开关。共享 `useMediaQuery` 监听 767 px 断点并清理订阅。
- 设置通过头像菜单进入，菜单可快速切换真实曲库；右侧版块配置按钮不属于新增账户设置入口。
- 设置页分为账户与音乐库、外观、播放与操作、网络歌词、音乐推荐、用户数据。宽内容区采用左侧分类导航，窄内容区将分类放在顶部，按主体实际宽度适配。播放侧栏的显示、内容与顺序集中在播放分类；同步、备份恢复与本机快照集中在用户数据。分类切换不卸载表单，保留推荐草稿及检测结果；推荐配置仍需显式保存，密钥仍仅在会话内存。
- 设置不再提供默认浏览入口，主页始终以「全部」开始，旧 `views` 数据仅兼容保存、不再影响入口。主题色将默认（红色）、蓝色/紫色/绿色/橙色模板、自定义合并到统一 `Select`，菜单及当前值均带色块；自定义色块与六位色值共用边框，无效色值不写入偏好。歌词检测以红/绿/灰状态灯及文字表达异常/可用/未检测或停用，保留详情；音乐推荐显示「Last.fm 推荐」与「新歌手目标占比」，Last.fm / AI 可折叠且默认展开，Apple Music / Spotify 默认折叠，四项标题保留检测灯，检测中为黄灯。地区只显示代码，Apple 常用项为 `cn/us/jp/hk/tw`，Spotify 为 `US/JP/HK/TW/GB`；原配置中的其他合法地区只保留当前值，避免丢失设置。共用 Select 捕获外部滚动并更新定位，按钮离开视口时收起，忽略列表内部滚动；窗口 resize 和按钮尺寸变化也会更新位置，卸载清理监听。
- 默认界面字体为思源黑体 Adobe Source Han Sans 2.005R 的原始 Pan-CJK WOFF2（简体中文默认字形，覆盖中/日/英），约 14.27 MB，构建后为带哈希、独立缓存的字体资源；使用 `font-display: swap`，不依赖第三方字体 CDN。原始字体及许可不修改，许可完整记录在 `public/fonts/source-han-sans/LICENSE.txt` 与第三方许可清单中。固定像素文字使用 `--ui-font-scale` 按 14 px 标准缩放，歌词的独立字号和视口自适应字号保留原有约束。基础字号提供 13/14/16/18 px，属于设备显示偏好，不同步到其他设备，也不进入账号导出/恢复；桌面歌词复用字体定义，控件文字随字号同步，歌词保持独立。
- 字体菜单增加思源宋体（Adobe Source Han Serif 2.003R 原始 Pan-CJK WOFF2，约 19.75 MB）、系统黑体及系统宋体；两款思源字体均按 OFL 1.1 附完整许可证，不分发系统字体。字体资源仅在匹配的字体被实际使用时请求，系统字体直接使用设备字体；不通过菜单预览同时加载全部字体。字体选择与字号一起保存在 `tooku-display`，旧版只有字号的设备配置自动保留字号并默认思源黑体。
- 受管上游账号数据以 SQLite 为主，设置日常仅显示保存状态、统一导出和恢复。迁移冲突、409 或未知结果读回后才出现版本比较，继续保护旧缓存和导入前副本。未通过后端策略或验证的直连模式只保存在本机，也能导出/恢复。恢复不接管当前音频，queue/history 的保存保护保持到下一次登录。
- 独立歌曲页已取消，旧 `/songs` 兼容地址转到 `/search?type=songs`。主页筛选为全部、歌单、专辑、歌手；歌手卡片复用 `components/ArtistGrid.tsx` 并进入现有歌手详情页。主页不显示底部曲库名与“浏览所有歌曲”小字。综合搜索保留歌曲分类，不再读取旧默认视图配置，也不改写这部分存储数据。
- 专辑列表使用 `MusicApi.allAlbums`，自动按最多 500 张顺序读取，读完统一显示；不监听滚动追加，也不使用 `content-visibility` 跳过卡片绘制，以免滚动时估算高度闪动。请求可取消，按 ID 合并并在没有新 ID 时停止；失败显示统一重试，后台刷新失败保留上次完整结果。随机发现先按稳定顺序完整读取再打乱，其他排序由服务端处理。主页仍可使用小批量 `albums`。专辑/歌手列表各自提供每行 3/4/5/6/8 个，保存在 `tooku-display.gridColumns`，不进入账号同步和备份；按内容容器宽度限制实际列数，歌手详情专辑区沿用专辑选择。手机固定两列并隐藏每行数量菜单，不改写桌面列数。
- 歌手列表保持圆形卡片；详情统一为柔化背景、方形前景图片、大号歌手名、播放/随机/收藏和专辑区。旧版私人图片仍优先展示；管理员原生会话可悬停/键盘聚焦显示“选择照片”，点击打开文件选择与共享裁剪弹窗。新图由 `MusicApi.saveArtistImage` 上传 Navidrome，读回核实后清除该歌手的旧私人覆盖；不批量迁移，不写 Tooku 账号文档。右键可恢复服务器默认、重新读取或移除旧私人图片。写入结果未知时停止写入，先“重新读取”再人工核实。歌手图使用 `getArtist` 明确返回的 `coverArt` 经 `MusicApi.coverUrl` 生成图片地址；缺图/图片失败依次尝试该歌手本库专辑封面、主题渐变；专辑封面以方形主体和柔化横幅展示，不作为真实歌手照。封面按稳定专辑 ID 选择，排除明确属于其他专辑歌手的记录，所有图片失败后停止重试。播放和专辑区使用纯色背景。所有路由的主浏览区隐藏原生滚动条，由 `ContentScrollbar` 在右缘叠加无箭头、透明轨道和 8 px 半透明滑块，贴边且悬停变亮，不占内容宽度，也不替换主滚动容器；左栏与播放侧栏复用 `ScrollArea`，弹窗、菜单、横向表格使用全站原生回退样式；支持轨道点击、拖动、方向键、翻页键及 Home/End。Navidrome 的图片源取决于服务端本地图与外部元数据设置，当前页面展示旧版私人图片与 Navidrome 图片，管理员可手动上传到 Navidrome，不存图片认证 URL；联网来源仅通过独立脚本试验，尚未自动接入页面。播放仅在主动点击后读取本库歌手专辑，全部成功后统一交给 `player`，切页/切库取消未完成操作。
- 专辑、歌手、歌单详情复用 `PlaybackButtons`：播放主按钮加随机图标按钮，附加收藏/更多复用 `IconButton` 与 `entity-controls`。封面悬停播放、表格逐曲播放和底栏传输控件保留其布局语义。
- 底栏歌曲标题按当前 `QueueEntry.source` 跳转专辑或歌单，artist/collection/未知来源以歌曲所属专辑兜底，缺少专辑 ID 时通过既有 song 查询补全；仍无法解析时仅显示文字。通过路由 state 携带账号身份、来源和歌曲/序号，`TrackList` 等数据就绪后在主 `.content` 滚动区居中并聚焦行，不增加定位左边框/高亮，保留标准键盘焦点；重复点击同一路由也可重新定位。不同账号请求忽略，不调用播放器命令。来源列表变动时按歌曲 ID 找最近仍存在的位置；旧快照没有序号时定位首个匹配，不推断重复项。
- 底栏可显示当前歌曲的小封面；悬停时图片和蒙版保持原位，共用外层圆角，仅桌面端蒙版内向上图标做一次 480 ms、3 px 上浮回弹；系统或应用减少动态效果时不播放该动画。左栏底部不再放独立的大封面或额外暂停按钮。右侧操作依次为队列、音量、桌面歌词、全屏，桌面歌词紧邻全屏按钮左侧；桌面歌词通过浏览器画中画置顶，复用来源、译文/罗马音开关与偏移，外语原文和已有中文译文上下显示。没有时间轴时手动滚动，不伪造同步。请求初始 480 × 180，默认位置与拖动后的记忆由浏览器决定，网页无法强制右下角；需文档画中画支持和安全上下文（本机地址或 HTTPS），不支持/失败显示应用提示。浮窗不持久化打开状态，切页/切库不关闭或重建音频，切账号/退出登录/卸载时关闭，迟到窗口也会关闭。
- 桌面/平板完整队列通过栏内绝对定位层覆盖原侧栏，不使用“正在播放/队列”切换，也不另外挤占主体宽度。原侧栏保持挂载并在覆盖时 inert / aria-hidden，保留滚动与歌词状态；队列独立滚动。关闭按钮、底栏队列按钮或 Escape 先收起队列，继续显示侧栏，窄屏再次 Escape 才收起侧栏。220 ms 透明度与短距离纵向过渡，退出后卸载队列内容，快速重开取消退出定时器，减少动态效果时立即切换。打开聚焦队列关闭按钮；关闭恢复触发按钮，触发按钮在窄屏不可交互时聚焦侧栏操作。队列不是第二份播放状态；其“当前播放 / 接下来”反映引擎真实队列。
- 手机主界面底栏不挂载 Transport / Progress / Favorite / Volume，直接复用提取的 `PlayPauseButton`，保留封面、歌名/歌手、队列、桌面歌词与播放/暂停，头像仍为唯一账户入口。手机主浏览区播放/随机操作减少垂直留白，封面和图标仍保留触控区域。视口使用 `viewport-fit=cover`，头/底栏高度包含 safe-area，缩小底栏后主体随 `--dock-height` 自动让位。
- 手机完全不渲染 NowPlayingPanel，队列只由 `MobileQueueSheet`（共享 Modal 的 `mobile-queue` 变体）展示；原 sidePanel 偏好不因开关队列而变化。默认 75dvh，手柄上划超过 32 px 展开到 100dvh（安全区内），下划恢复；拖动预览只更新该 dialog 的 CSS 高度变量，抬起归位并清理捕获，取消/失去捕获/卸载清除预览。点击手柄或上/下键可替代手势，列表滚动不触发拖动；高度切换不重挂载队列滚动区。进入/退出有纵向过渡，减少动态效果时停用；共享 dialog 提供关闭、Escape、背景关闭与焦点恢复。关闭后直接回浏览页，切回桌面时关闭手机队列，不接入或重建音频。紧凑队列行复用统一选项菜单提供上移/下移/移除，按真实队列索引操作，保留重复项；当前歌曲另有播放/暂停。
- 左栏“为你推荐”进入 `/recommendations`，主页“全部”展示带说明的简洁入口，不放歌曲明细、不自动生成或核实链接。数量可选 10/20/30（默认 30），保留最近结果。Last.fm 覆盖提交的样本并平衡来源；混合模式排序并提名经核实的新歌曲。略过或多样性筛选后数量不足时，向 AI 提交已选/已尝试候选与缺额，最多两轮补充，达到目标停止；失败保留可用结果并说明缺额，不重放失败的模型请求。跨批避重同时比较近期 90 首的歌名/歌手和已知录音室版本；未知附注、现场、翻唱和混音保持区分，目录改名后再检查一次。同歌手、已知同专辑最多一首。推荐页使用单一标题与一行批次信息；未生成时显示“暂无推荐 / 从最近在听推荐新歌”。表头“时间”使用文字，歌曲/歌手/专辑/时间复用共享列宽偏好，悬停边界可拖动，支持键盘微调和双击恢复默认；每首一行，歌名和歌手分列，字号/行距沿用歌单，专辑、可信日期和时长缺失为“—”，无封面占位。进入页面即六首分组、两组并发核实整批外链，每组完成更新缓存及菜单，缓存五分钟。点击行/标题、右键和键盘激活打开统一平台菜单，未完成显示核实提示，失败直接搜索兜底，不提供重试入口，不播放。日期、时长、专辑仅使用目录已返回字段，核实时清除 AI 猜测；不新增封面请求。目录成功查询缓存五分钟、正常空查询三十秒，256 项、每项最多 32 KiB；Spotify 令牌按有效期提前失效、最多 16 项，仅进程内存、凭据/地区隔离，合并并发读且取消互不影响，服务关闭清理。Last.fm 明确认证/Key/限流错误立即停止当批后续查询，保留完成结果、允许 AI 继续，不保存永久停用状态。
- 推荐服务检测就地显示状态；编辑对应配置取消检测并清除旧结果。DeepSeek 根地址和 /v1 统一为 /v1/chat/completions，检测/生成共用严格 TLS、默认及系统 CA、非流式非思考 JSON；空内容、截断、协议不兼容、认证、余额等错误分别提示，不暴露上游原文。统一 `Interactions` 菜单支持原生外链与仅更新仍打开菜单的 handle，异步更新保留焦点，不允许迟到重开；详见 [音乐推荐](16-music-recommendations.md)。

### 列表、歌单与目录

- 歌曲标题及播放按钮有明确入口；双击行空白是补充操作，不拦截歌手、专辑等链接的自身语义。
- 表格使用同一底色，仅悬停/选中反馈；列宽可调。加入队列、下一首、添加歌单、移动等操作进统一右键菜单，行尾只留收藏。
- 收藏页的歌曲、专辑、歌手筛选与主页共用 `FilterPills`，保留键盘焦点与按下状态，支持窄屏换行。三类内容分别复用歌曲表格、专辑网格、圆形图片加姓名的歌手网格；空状态仅显示“还没有收藏的歌曲/专辑/歌手”，不加引导小字。收藏歌手保留接口返回的 `coverArt`，复用已有自定义图片与加载失败回退。
- 普通歌单详情采用播放、随机、更多选项的操作组；封面悬停/聚焦显示“选择照片”，点击直接选择图片并裁剪，保存后仅更新 Tooku 账号封面；三点菜单进入名称、简介和封面编辑；编辑弹窗使用 210 px 方形封面，与右侧表单上下对齐，名称与简介分组留出间距，窄屏改为上下排列。不使用单独曲目编辑页。长歌单时长约到整小时，短于一小时保留分钟，专辑仍保留原分钟精度。
- 有权限的歌单可在列表直接拖动保存，重复歌曲保留；保存成功不显示通知或撤销按钮；失败后显示错误并可重读核实，不自动重试结果未知的写入。
- 歌单管理主体仅浏览，卡片保留图片与名称，不提供拖放或引导小字；左栏保留歌单/文件夹拖动，歌单位置用横线提示，文件夹内部只变色，根目录末尾保持固定落点以免拖动时布局闪烁。`components/dragPreview.ts` 为左栏和歌曲拖动清除默认链接数据，仅携带 Tooku 自定义 MIME，使用名称或“歌曲 · 歌手”的精简预览；预览在下一帧、拖动结束或卸载时清理。Chrome 自身是否仍显示系统拖放功能需人工确认。歌曲上移/下移菜单、权限和重复项不变，列表已更新时拒绝过期拖放。
- 主体卡片和左栏文件夹不显示三点图标，操作保留在右键菜单；详情页保留三点菜单。新建歌单不显示“创建于…”提示，根目录在文件夹选择和路径中统一写作 `/`。
- 歌单权限规则共用 `domain/playlistPermissions.ts`：优先识别服务端明确的 `readonly: false`，缺失时兼容拥有者判断；`readonly: true` 禁止改动歌曲，元信息仍按拥有者权限判断。无编辑权限时显示锁图标和“只读歌单”，封面提示无法修改；拥有元信息权限但曲目由服务端管理时显示“自动维护歌单”，悬停/聚焦说明应修改原 m3u/m3u8 文件后重新扫描。歌曲添加、详情页和 `MusicApi.savePlaylist` 写前读取共用判断，真正的写入权限仍由服务端裁决。可拖动行禁止文字选择，普通只读行仍可选择文字。
- 左栏歌单区的新建图标创建歌单，可选择文件夹，留空为根目录；管理页在根目录或文件夹内就地创建歌单/文件夹。
- 左栏文件夹默认展开；`organization.collapsedFolders` 仅记录折叠的文件夹 ID，浏览器刷新、切库后保留，通过既有账号同步写入 Tooku SQLite。展开全部时省略该字段，旧数据和旧备份仍默认展开。删除文件夹会清理对应状态，子文件夹状态保留。
- 文件夹和歌单混排。不能把文件夹移入自身或子级；删除文件夹将内容归位上一级，不删除 Navidrome 歌单。

### 表面、文案与动效

悬停提示仅从显式 `data-tooltip` 读取，不从无障碍 `aria-label` 推导；`IconButton` 默认提供常规操作提示，Logo、歌曲/专辑/歌手文字链接、队列曲目和分栏拖动条保留无障碍名称而不显示提示，状态/权限的必要解释仍可显式启用。底栏播放/暂停按钮常态使用 `--text` 背景与 `--bg` 图标，悬停成对使用 `--accent` / `--accent-contrast`，保证亮暗主题对比。

沿用现有系统字体栈、圆角面板、克制阴影和短过渡。颜色来自 token，图标来自 Lucide；封面、歌曲和歌单是视觉主角。不要增加营销横幅、冗余小字、伪造推荐或随意使用品牌绿覆盖 Tooku 主题色。

复用 `IconButton` 的中文名称和应用 tooltip。使用 `data-tooltip` 提供其他提示，默认上方浮现、边缘翻转。统一菜单须在深浅主题中可读、可用 Esc 关闭、可通过键盘访问；弹窗内浮层不应被遮挡或变成不可点击。

展开播放器采用柔化封面铺底，左侧大封面、歌曲信息与播放控制，右侧大字歌词；不显示品牌、动态歌词标签、音频格式、普通播放状态和底部下一首预告等小字。左侧封面与控制区固定，按剩余空间缩放封面，内部列显式 `minmax(0, 1fr)`，元信息和控制区域宽度受限；超长歌曲名/歌手名用 `ScrollingText.tsx` 在单行区域内自动往返滚动，悬停/聚焦暂停，减少动态效果时手动横向查看。桌面不依靠左侧或整个播放器滚动；手机改为封面/控制与歌词两个整屏页面，通过单一 transform 轨道切换，不放底部翻页提示，也不再上下各占一半。布局按 CSS 可用宽高适配 1K / 2K / 4K 与浏览器缩放；封面、列间距和歌词字号使用有上下限的视口尺寸，主体最大宽度 2880 px，歌词阅读区最高为 64dvh / 1160 px，避免大屏铺满整屏。进度时间分别左、右对齐。来源、歌词设置、浏览器全屏和收起图标统一放在顶部一行，无胶囊外框，竖线分组；QQ 来源使用同色企鹅图标；歌词设置分为显示/版本两页，显示页不放预览；弹窗固定标题，内部内容滚动避开 12 px 圆角，输入框统一 44 px 高的主题表面与焦点边框，并在滚动层预留边框空间；显示页“自动识别”、重置/刷新同行、保存单独一行，版本页先输入歌曲标题与歌手，再选择平台并搜索，不放刷新；仅右侧歌词容器滚动，右上角收起；不放歌词/队列切换、音量或底部歌词设置；显示与版本调整集中在顶部歌词设置面板。展开页右键与收藏右侧三点按钮复用同一当前歌曲菜单，内部输入框保留文本编辑菜单；三点按钮复用统一菜单，可查看专辑、歌手、歌单，以及打开已有添加歌单弹窗；页面跳转时收起播放器，不改变音频。缺少专辑/歌手 ID 时尝试已有 song 查询补全，仍缺失则禁用对应入口；查看歌单只打开当前队列出现项的 `source.kind=playlist` 所指歌单；无来源时禁用，不跳总管理页，也不通过歌曲成员关系猜测播放来源。异常状态仍提供必要反馈。共用歌词仅在手动浏览时显示“同步”，闲置 5 秒后恢复自动跟随并收起按钮；展开页通过继承的 `--lyric-anchor: .42` 将当前歌词组中心放在阅读区中部略上，侧栏与窄屏为 .5；首尾使用独立 `--lyric-before` / `--lyric-after` 留白，使第一句、最后一句和换行长句也能对齐锚点。调整尺寸或字体后重新计算，不滚动整页。系统和应用的减少动态效果设置均需考虑。

歌手图片写回入口集中在 `src/api/client.ts`：登录时仅对 Navidrome 尝试 `/auth/login`，原生 JWT 与角色只留会话内存，退出清除；密码只传给登录请求。`POST /api/artist/:id/image` 使用 `image` multipart 字段，`DELETE` 恢复默认，写前/后均读取 `/api/artist/:id`。HTTP 权限错误由 Navidrome 最终裁决，不自动重放上传；确认后的预览仅留查询内存，等待上游构建图片。`server/navidromeProxy.ts` 为开发/生产共用路径及方法白名单，仅新增登录与歌手图片所需路由；不开放其余原生管理接口。原生认证失败不阻断 Subsonic 登录，旧版服务器或直连 CORS 配置不支持时无法编辑。协议参照 [Navidrome v0.64.1 上传实现](https://github.com/navidrome/navidrome/blob/v0.64.1/server/nativeapi/artists.go)。

手机分页集中在 `PlayerPages.tsx` 与 `player-pages.css`：横向只有一个位置源，拖动直接写轨道 style.transform，避免逐帧更改父级可继承 CSS 变量；160 ms 松手过渡优先用 Element.animate 的 transform 动画，不在主线程逐帧调度，缺少/拒绝原生动画的 WebView 回退同轨道 rAF。原生动画中断时仅读一次合成 transform 矩阵，冻结可见位置再取消，完成后先提交终点内联样式再移除效果，防止回闪；取消旧回调，忽略迟到完成事件。根区域 overflow: clip，彻底移除原生横向滚动、scroll-snap、scrollLeft 读写与静止定时器，防止原生惯性/吸附、逐帧滚动和焦点更新之间争抢。局部 touchmove 通过 passive: false 注册，useEffectEvent 读取最新逻辑；方向锁定为横向后才 preventDefault，原生纵向歌词、进度条、按钮和元信息排除，不能全局禁止触摸滚动。位移钳制 0 到页面宽度，按实际位移/近期速度判断翻页；触摸取消、多指、捕获丢失回到该手势的稳定页。打断收尾从当前绘制位置继续，不读旧页坐标；ResizeObserver/window.resize 仅宽度真正改变时重排，忽略地址栏等高度变化，卸载/断点/减少动态效果时清理动画和监听。两 section 持续挂载，收尾后才切换 inert/aria-hidden 和焦点；overflow: clip 避免聚焦改变横向滚动。歌词设置 portal 挂到外层 dialog/body；不放歌词返回按钮/底部提示，不恢复下滑收起，关闭仍用 Modal 收起按钮或 Escape，切页不重建音频。

滚动歌名/歌手共用 player.css 的 .scrolling-text：overflow-x: auto / overflow-y: hidden，同时保留 scrollbar-width: none 与局部 ::-webkit-scrollbar 的 display: none、width/height: 0，覆盖全局 8 px WebKit 滚动条规则。不能仅靠标准属性隐藏滚动条，也不能为隐藏条纹而取消横向查看或减少动态效果模式；底栏与展开播放器共用该规则。性能设计参考 [动画与性能](https://web.dev/articles/animations-and-performance)，兼容规则参考 [Chrome 滚动条样式](https://developer.chrome.com/docs/css-ui/scrollbar-styling)。

系统媒体集成在 `engine.ts` 的 #media：元数据附带当前曲目的封面 URL，由 api.coverUrl(coverArt, 512) 即时生成，省略无法确认的图片类型/实际尺寸提示。比较标题、歌手、专辑与封面后再更新 MediaMetadata，避免时间进度上报反复重置 artwork；无当前歌曲、无封面、空队列恢复与退出需清理旧元数据。认证图片 URL 只交给浏览器媒体会话，不落库、不写快照或日志；没有创建图片下载代理或另一套音频。标准参考 [Media Session](https://www.w3.org/TR/mediasession/)。

## 5. 数据归属与当前限制

| 数据 | 当前保存位置 | 作用域 / 事实 |
| --- | --- | --- |
| 音乐文件、专辑、歌手、新上传的歌手图片、服务器收藏 | Navidrome | 以服务器授权和返回值为准 |
| 歌单名称、简介、曲目和曲序 | Navidrome | Tooku 通过协议读写并核实 |
| 头像、自定义歌单封面及旧版私人歌手图片 | SQLite 自动保存/恢复；localStorage 缓存：`tooku-profiles` | 本地按 `api.identity`，服务端按已验证 owner；旧版 data URL 不自动上传 Navidrome |
| 文件夹及展开状态、歌单位置/混排、曲库视图与选中库 | SQLite 自动保存/恢复；localStorage 缓存：`tooku-library-organization` | 内部按真实 `libraryId` 组织；不是音乐服务端目录 |
| 明暗、主题色、布局、列宽、歌词和快捷键偏好 | SQLite 账号文档 / IndexedDB sync；`tooku-preferences` 作为当前偏好与设备回退 | 切号还原设备回退，账号修改存在各自 sync 缓存 |
| 界面字体与基础字号 | localStorage `tooku-display` | 此浏览器的设备显示偏好，切账号保留；不进入用户账号文档或备份 |
| 上次成功登录的服务器地址 | localStorage `tooku-login-server` | 仅安全服务基址，无账号/密码/查询/锚点；返回或刷新登录页回填，不进入账号同步或备份 |
| 队列、暂停位置、历史 | SQLite 最后保存的账号快照 / IndexedDB | key 由 `identity` 与种类组成；下次登录暂停恢复，不实时接管播放 |
| 同步基线、未上传数据、导入前副本 | IndexedDB `profiles` 中 `sync` / `before-import` | 原数据保留；清除本机播放快照不清迁移基线 |
| 查询结果 | TanStack Query 内存 | 按身份与相关库隔离，不等于持久化服务端数据 |
| 推荐普通设置、最近一批及有限避重元数据 | SQLite 账号文档 / IndexedDB sync；`tooku-recommendations` 本机回退 | 服务密钥在独立安全库，平台链接与目录缓存不进账号文档 |
| 推荐目录结果 / Spotify 临时令牌 | `server/recommendations/cache.ts` 受限进程内存 | 按相关凭据/地区隔离并过期，不落库；取消和关闭清理规则见 16 号文档 |
| 密码、认证材料与服务密钥 | 密码不保存；目标、认证材料/密钥经 `server/vault.ts` 加密进入独立安全库 | 受管上游持久会话；账号备份不含凭据，未登记直连模式仍仅会话内存 |

当前 `MusicApi.identity` 使用 `${base}|${username}`。更换访问 origin、代理基址、账号写法或身份规则，可能让旧数据不可见；不能通过简单更名身份来解决串号问题。

Navidrome 的 `getPlaylists` 返回账号可见的歌单。每库归属是 Tooku 的 `placements`，不能把它误当成协议天然返回的每库独立歌单集合。`getArtist` 可能聚合多个曲库，当前有专辑边界过滤，不能为了少发请求直接删除。

清理站点数据、更换浏览器/设备、访问 origin 变化会影响本机数据；IndexedDB 也受此限制。已上传的数据可经同一 Tooku 部署、同一固定上游账号恢复。服务器空时自动上传原浏览器数据，新浏览器本地空时自动读取；只有两端均有不同个性数据或待核实结果时需预览选择。默认库 ID 与空队列不阻断同步，已经同步的账号删除操作仍需保留。同步缓存新增可选 `requiresReview` 字段，兼容旧版 v1 缓存。自动保存遇到冲突停止，不做字段合并。设置支持账号 JSON 导出/恢复，管理员使用 `npm.cmd run backup -- <新文件>` 做完整 SQLite 在线备份。详细边界见 [服务端持久化](13-server-persistence.md)。

### 持久化的维护约束

音乐推荐在账号文档 v1 可选 `recommendations` 字段保存普通设置与最近一批最少元数据；可选 `settings.resultCount` 缺省按 30，`seenIds` 最多 300 个 ID，`recentSongs` 最多 90 首的 ID/标题/歌手供模型避重。旧版仅 settings/batch 的文档、备份和本地存储继续可读，不清空数据；`tooku-recommendations` 仍按旧 identity 回退，随现有同步与 revision 流程处理。恢复旧备份重置当前账号推荐数据，其他账号不变。密钥在独立安全库按账号加密保存，前端仅保留草稿和保存状态，退出/切账号清空前端状态，平台链接与封面仅短时缓存，不进入备份；详见 [音乐推荐](16-music-recommendations.md)。

现有轻量后端将图片与元数据一起存入受限 SQLite 版本文档，以同一事务替换并回收旧图；没有独立图片目录。后续演进继续遵守：

1. 先定义哪些数据继续归 Navidrome、哪些归 Tooku；不复制一套可独立修改的服务器歌单真相。
2. 保留现有本地数据，提供迁移预览/导入、冲突处理、失败重试及备份恢复，不静默覆盖或清空。
3. 服务端身份必须经过验证，不能只相信客户端传入的用户名；禁止把裸密码搬到数据库。
4. 数据结构带版本，变更有迁移；图片有限制与清理策略，避免浏览器容量问题直接平移到无限服务端上传。
5. Docker 需要持久化数据卷、权限与恢复验证；创建 SQLite 文件不等于完成备份和跨设备同步。

## 6. API、播放与异步修改范式

### 服务数据

在 React 内通过当前 Provider 的 `useQueryClient()` 更新缓存。既有模块使用过共享实例，新代码不要引入第二个 QueryClient，也不要绕开测试 Provider 更新另一份缓存。

查询 key 的形式沿用 `[api.identity, resource, ...scope]`，依赖库的资源带上 `libraryId`。传递 Query 提供的 `AbortSignal`；保留取消、能力降级、空数据与错误的区别。HTTP 200 不代表 Subsonic 业务成功。

接口字段在 `MusicApi` 中转换到 `Track`、`Album`、`Playlist` 等真实类型；秒值和毫秒值不能混用。OpenSubsonic 正 offset 在现有实现中转换为内部负延迟，展示与点击定位都要用同一套换算。

### 写入与编辑

歌单曲序使用 `savePlaylist`，基本信息使用 `updatePlaylistDetails`，不要为修改简介重写所有歌曲。先检查 `changed`，写后重读验证；失败/超时不能盲目自动重试。保留已知的非原子并发限制。

异步操作期间防重复提交；拖放发生后如果列表已变化，应取消旧拖放。歌单详情按 ID 隔离状态，避免旧歌单的异步结果进入新歌单。只读按钮和拖放都应禁用，但权限仍由服务器执行。

### 播放

UI 只调用 `player.replace/append/select/move/remove/play/pause/seek` 等命令；状态从 `usePlayer` 读取。不要给页面加第二个 `<audio>`、以 React key 重建播放器，或在切库时 `attach/logout` 现有引擎。

队列出现项可带 `source: { kind, id, libraryId? }`，实体来源为 album/playlist/artist，收藏、最近收听和搜索使用 collection；记录实体 ID，不保存路由或认证 URL。各页面、主页/搜索卡片、表格的按钮/标题/双击/键盘/右键与加入队列入口统一传递来源。`replace(tracks, index, { source, shuffle? })` 由引擎判断模式：同一来源普通点歌保留随机，相同原始歌曲序列按索引映射到原有 entryId（含重复项），不重洗既有队列；内容已变更则按现有模式重建。不同来源默认顺序播放，显式 `shuffle: true` 始终启用随机，手动关闭后同一来源不自行恢复。无来源旧入口仅以完整原始歌曲序列回退判断，不猜测歌单。追加项独立携带来源，撤销及暂停恢复保留来源与随机原序；同步/导入仍不接管当前音频。

受管播放地址由 `MusicApi.playbackUrl` 与 `server/api.ts` 的 grant 状态生成，实际代理在 `createPlaybackProxy`。不要恢复通用 `/api/navidrome/rest/stream`/download，也不要在页面拼接授权 URL。授权只留播放器内存，绑定会话、owner、歌曲与转码模式；新曲、重新登录和退出撤销旧流。PlayerEngine 等待授权时仍用 generation 隔离快切结果，等待期间暂停不得在授权返回后自动播放；临近过期只在恢复播放时更新地址并保留秒数。受管流响应须保留上游字节、Content-Length、单段 Range/206 与 Content-Range，但对浏览器统一使用 `application/octet-stream`，避免扩展只依赖 `audio/*` MIME 自动登记媒体；不要按下载器名称或 User-Agent 建黑名单，也不要为隐藏类型破坏 seek。修改时回归 GET/HEAD、原始/兼容模式、seek、并发/请求上限、注销/切号、上游重定向、no-store/inline、MIME 掩码和 Nginx 日志排除。直连模式仍走 Navidrome URL，不能宣传全部服务器均已保护。

队列中每次出现都有独立 `entryId`，收听记录有 `occurrenceId`。同曲不同次的播放、随机、循环和撤销必须保留这些语义。异步播放 promise、恢复快照和晚到 API 响应都要处理过期结果；拖动进度不能计为有效收听。

## 7. 样式定位与变更方式

入口 CSS 当前按 `styles.css → features/player/player.css → workspace.css → browse.css → interactions.css` 导入，组件还会导入 `panel.css`、`pages/home.css` 等文件。不要只凭文件名称推断最终覆盖关系，必要时检查浏览器计算样式。

| 文件 | 当前重点 |
| --- | --- |
| `src/styles.css` | 基础元素、早期页面与通用结构 |
| `src/workspace.css` | 当前主题 token、全局头部、三栏及响应式工作区 |
| `src/browse.css` | 统一选择器、头像裁剪、实体封面、搜索、队列等浏览表面 |
| `src/interactions.css` | 菜单/tooltip、分栏与列宽手柄、当前歌单/目录及歌手过渡样式 |
| `src/features/player/player.css`、`panel.css` | 完整播放器、歌词与右侧模块 |
| `src/components/content-scrollbar.css`、`src/scrollbars.css` | 主浏览区/侧栏浮动滚动条、其余滚动区域原生回退 |
| `src/pages/home.css` | 独立主页 |
| `src/pages/login.css` | 登录页品牌主视觉、无边框表单、连接检测状态与响应式；复用 `workspace.css` 的亮色 token 并固定中性强调色，背景/文本选中/控件焦点均不使用用户主题；强制高对比模式保留系统焦点 |
| `src/features/session/enterWorkspace.ts`、`login-transition.css` | 连接、同步恢复和单次播放器接入成功后，用 View Transitions 共享左上角标志/文字，其余页面交叉淡入淡出；同步提交 DOM、绘制前恢复主题，完成后聚焦主区；动画不可用或失败不阻断登录，尊重应用/系统减少动态效果 |
| `public/tooku.svg`、`src/components/TookuMark.tsx`、`tooku-mark.css` | 落日、远山与湖面组成的无文字彩色标志；SVG 同时作为 favicon，组件直接显示同一素材，保留渐变与层次，不随主题色重着色 |
| `src/components/filter-pills.css` | 主页/收藏共用圆角筛选，含选中、悬停、窄屏与减少动态效果 |
| `src/pages/album-browse.css`、`artist-detail.css` | 专辑自动加载表面、歌手横幅及详情布局 |
| `src/features/settings/settings.css` | 设置分类、分区、行、开关、推荐表单和同步/备份操作；设置样式从全局与歌词/推荐页面样式中收拢 |
| `src/fonts.css`、各模块的 `font-size` 声明 | 自托管思源黑体；固定字号通过 `--ui-font-scale` 缩放，不通过 CSS zoom 放大布局，不额外覆盖业务选择器 |

这是一份现状地图，不要求继续把所有业务样式堆进通用文件。按任务逐步收敛组件的样式责任，避免重复规则、不断追加覆盖和大范围 `!important`。修改表格断点时结合主体容器宽度，不能只看整个 viewport。

## 8. 验证与交付尺度

普通业务改动执行适用的 Lint、类型/构建和相关测试。`npm.cmd run build` 已包含 `tsc -b`，无需为相同代码重复做多轮相同检查。没有配置 `test:e2e` 脚本，不能把浏览器工具检查描述成已通过完整自动化 E2E。

| 修改范围 | 优先参考的测试 |
| --- | --- |
| 协议、认证、元信息写入 | `tests/api.test.ts` |
| 队列算法和有效收听 | `tests/queue.test.ts` |
| 音频生命周期、过期播放结果 | `tests/player.test.ts` |
| 歌词、进度、弹窗和播放器 UI | `tests/player-ui.test.tsx` |
| 多库、目录边界、混排 | `tests/library.test.ts` |
| 歌单拖放保存、文件夹展开状态、只读、列表、链接 | `tests/organization-ui.test.tsx` |
| 搜索输入法 | `tests/search.test.tsx` |
| 菜单、提示、焦点 | `tests/interactions.test.tsx` |
| 专辑播放入口 | `tests/albums.test.tsx` |
| 主页内容与导航前进/后退 | `tests/home.test.tsx`、`tests/navigation.test.tsx` |
| 时长显示与汇总 | `tests/duration.test.ts` |
| 桌面画中画歌词、双语/静态正文、关闭与账号隔离 | `tests/desktop-lyrics.test.tsx` |
| 歌词整理、平台服务、来源协调与迟到响应 | `tests/lyrics-normalize.test.ts`、`tests/lyrics-service.test.ts`、`tests/lyrics-source.test.tsx` |
| 推荐样本、多样性/补量/避重、模型协议与 HTTP 边界 | `tests/recommendations.test.ts` |
| 推荐页/主页入口、平台菜单、列宽与设置检测 | `tests/recommendations-ui.test.tsx` |
| 设置分类键盘访问、主题色输入、检测灯、未保存草稿/检测保留、播放连续性、数据覆盖确认 | `tests/settings-ui.test.tsx`、`tests/settings-data-ui.test.tsx` |
| 推荐缓存过期、并发/取消、凭据地区隔离及令牌复用 | `tests/recommendation-cache.test.ts` |
| 专辑自动分页、失败重试、重复页 | `tests/album-browse.test.tsx` |
| 全站浮动滚动条几何、拖动、键盘及清理 | `tests/content-scrollbar.test.tsx` |
| 歌手横幅、缺图、管理员上传/旧图清理、播放及切页取消 | `tests/artist-detail.test.tsx` |
| 歌手封面稳定回退、组合名搜索和来源候选解析 | `tests/artist-artwork.test.ts` |
| 收藏分类空状态、歌手卡片/图片回退和接口图片字段 | `tests/favorites.test.tsx` |
| 原生图片认证、管理员权限、写后核实、结果未知和并发写入保护、代理白名单 | `tests/artist-image-api.test.ts` |
| 歌单显式只读、拥有者回退、元信息与曲序权限、只读写前检查 | `tests/playlist-permissions.test.ts` |
| Windows 端口回退 | `tests/startup.test.mjs` |
| 服务端身份、SQLite、限额、备份、重启 | `tests/user-data.test.ts` |
| 迁移确认、离线、冲突、账号偏好隔离 | `tests/user-sync.test.ts` |

隔离测试服务：`node tests/fixtures/server.mjs`，仅本机 44534；登录地址填 `http://127.0.0.1:44534`，用户名 `fixture`，密码任意非空测试文本。它是简化的内存 fixture，不代理真实 Navidrome，也不保证覆盖后续增加的全部接口字段；测试新能力时先检查 fixture 是否支持。

最近已执行的检查统一记在 [开发记录](09-development-status.md)，附日期、对应代码提交、自动化与人工边界。后续功能任务只报告当次执行结果；文档任务不将旧基线写成重新验证，也不为更新数字重复跑全套测试。移动实机、全格式音频、长期播放、真实平台地区权限与 Docker 验收仍需相应证据。

用户目前偏好少量基础错误验证，详细效果留给人工。最终回复直接列出本次需要看的几项，不新建手工验收文档。纯文档改动检查链接、事实和 diff 即可。

歌手联网来源的公开样本试验见 [歌手图片补齐试验](14-artist-artwork-experiment.md)。`scripts/probe-artist-artwork.ts` 仅做独立命令行联网试验，结果写入 `.local`；用户已决定暂不接入网络补图；页面尚未自动采用外部候选，不能将试验覆盖数当作匹配正确率或已经接入的功能。

## 9. 常见任务的最短路径

- **改全局布局**：`App.tsx` / `WorkspaceHeader.tsx` → `workspace.css` → 核对紧凑侧栏和底栏；避免重建音频。
- **改歌曲操作**：`Common.tsx` 的 `TrackList` → `useContextMenu` / 列宽组件 → 必要的列表交互测试。
- **改歌单或目录**：`PlaylistViews` / `Organization` → `state/library.ts` 或 `MusicApi` → 判断本地修改还是服务器写入 → 验证重复项、权限、并发与库边界。
- **改歌词**：`Lyrics.tsx` → 对应播放器样式 → 几何与时间换算测试；保留“同步”和 5 秒空闲恢复。
- **改桌面歌词**：`DesktopLyrics.tsx` → `domain/lyrics/timing.ts` / `useLyrics` → 画中画生命周期测试；沿用同一音频、QueryClient、主题和偏移，不能承诺网页强制窗口坐标。
- **改推荐**：推荐页面/设置 → `domain/recommendations.ts` → `server/recommendations/` → 按需执行服务/UI/缓存测试；保持手动生成、整批链接核实和失败搜索兜底，不加入已暂缓的“不感兴趣”功能。
- **修启动**：先看 `.local/server-url.txt`、健康端点和启动日志 → 启动器/代理；不要先改系统网络或停止 Navidrome。
- **加持久化**：先梳理本指南的数据表与当前 namespace → 设计迁移和身份验证 → 再实现存储/接口，不把 IndexedDB 改名成“服务端数据库”。

## 10. 维护规范本身

入口、数据归属、Provider、缓存身份、启动命令或主要交互改变时，同步更新 [AGENTS.md](../AGENTS.md)、本指南和 README 中受影响的段落。当前约定以这些入口和对应组件文档为准；进度、测试数量、提交和未测边界集中记在 09 号开发记录，避免多份数字漂移。维护历史文档时添加版本提示，保留原日期与已发生的证据，不用最新结果覆盖旧测试记录，不把未实现建议变成自动开工任务。

## 11. 网络与双语歌词

[独立歌词组件方案与实现](15-lyrics-service-design.md) 描述当前接口与维护边界。Tooku 自己维护网络检索、匹配、缓存、状态与共用双语整理；Navidrome 仅为现有本地输入渠道。来源仅本地、网易云和 QQ，默认本地优先、明确缺失时自动联网并采用相近版本，允许事后修正；本地只有外语原文时仍保留本地，不自动替换成网络版本。纯音乐、占位或最终无正文统一显示“该音乐没有歌词，请欣赏”，网络真实错误仍保留在服务状态。

`MusicApi.lyrics` 保留结构化多轨与普通 LRC 原文；`normalizeLyrics` 负责毫秒时间轴、Unicode 多语言、结构化字段换行和四类双语格式；`domain/lyrics/matching.ts` 为前后端共用的匹配规则，比较歌手前兼容多人分隔、括号及平台 `artistAliases` 别名，保留歌名、时长、演出版本约束；网易云在既有搜索预算内最多补读两位歌手的固定 ID 译名，内存缓存 40 位 / 1 小时，失败保留候选；修改决策规则时更新前端网络查询代次，避免复用旧空结果，不清个人绑定或原始平台缓存。`useLyrics` 复用 Provider / QueryClient，按账号、曲目、元数据、来源、绑定和刷新代次隔离查询；歌词正文共享，两个视口独立滚动。切源与切歌取消过期前端请求，迟到结果不覆盖新曲目，不操作音频。

网易云无可信组合检索结果时，在同一搜索预算内仅追加一次歌名检索，合并排序后最多返回 10 项，仍校验歌手与时长；候选演唱者展示列表最多保留 20 位，避免无关合唱元数据阻断整批。QQ 固定新版 musicu 明文模式显式请求译文（trans=1 / crypt=0），协议或暂时故障回退旧接口，限流/登录要求不回退；无新解密或认证依赖。搜索缓存 v3、QQ 正文 v2，前端同步升级策略 key，保留个人选择与旧缓存。

网络客户端只访问同源 `/api/lyrics/{health,status,search,fetch,check}`，开发/生产使用同一 handler。服务无需 Navidrome 登录；同源检查不等于身份认证，不返回个人绑定。平台域名、ID、大小和速率受限，部署总开关为 `TOOKU_LYRICS_ENABLED=false`。设置开关是当前账号的策略，服务状态不在后台频繁探测。

账号文档新增可选 `lyrics`；`src/state/lyrics.ts` 提供本机按 identity 隔离回退，接入现有 revision、IndexedDB sync 与导出/恢复。旧备份缺少字段时重置当前账号歌词选择，保留其他账号。平台缓存为数据目录独立 `lyrics-cache.sqlite`，不进入账号备份；缓存故障退回内存，不清用户数据库。

基础测试：`lyrics-normalize.test.ts`（四类格式/歧义/时间配对）、`lyrics-service.test.ts`（适配器/缓存/HTTP/状态）、`lyrics-source.test.tsx`（选择/回退/迟到/双视图）、现有 API/播放器与用户同步测试。`node scripts/probe-lyrics.ts` 仅请求公开样本，摘要写入被忽略的 `.local/lyrics-probe.json`，不输出歌词正文或凭据。

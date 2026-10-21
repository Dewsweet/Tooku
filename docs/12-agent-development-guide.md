# Tooku 开发接入指南

更新日期：2026-10-21。面向首次接入本仓库的 Agent 和开发者，描述当前实现与查找入口。

根目录 [AGENTS.md](../AGENTS.md) 是开发约定入口；本指南提供模块地图、数据说明和常见改动路径。[01–11 号文档](../README.md#文档入口) 保留调研、设计演进及历史验证，其中的示意目录、旧交互和排期不等于当前实现。

## 1. 五分钟接入

1. 阅读 [AGENTS.md](../AGENTS.md)，检查 `git status --short`，确认任务边界和已有改动。
2. 从下方模块表找到对应源码；读取相关测试，不必从头阅读所有历史文档。
3. 使用 `npm.cmd run dev` 或 `start-tooku.cmd` 启动，读取 `.local/server-url.txt` 获取实际地址；默认 18733，Navidrome 默认 44533。
4. 有写入验证需求时优先使用隔离测试服务或授权的专用测试歌单；真实账号凭据只通过登录页输入。
5. 完成实现与必要的基础检查，按功能保存 Git 提交；人工功能和观感检查在回复中简列。

没有全局 pnpm 是受支持的环境。首次安装使用 `npx.cmd --yes pnpm@11.25.0 install --frozen-lockfile`，不混用包管理器。服务端使用内置 SQLite / TypeScript 执行，需要 Node 24+。

## 2. 当前架构

Tooku 0.1.0 是 SPA 与 Node.js / SQLite 用户数据服务，技术栈以 [package.json](../package.json) 为准：React、TypeScript、Vite、React Router、TanStack Query、Zustand、idb、Lucide React、Vitest 与 Testing Library。后端只用 Node 内置模块；未引入第二套 UI、状态或播放框架。

```text
React 页面 / 通用控件
  ├─ TanStack Query → MusicApi → /nd/rest → Navidrome
  ├─ useLyrics → TookuLyricsApi → /api/lyrics → 网易云 / QQ → 独立缓存
  ├─ player 命令 → 常驻 PlayerEngine → HTMLAudioElement
  ├─ Zustand / IndexedDB → 浏览器缓存、未上传修改与设备回退
  └─ userSync → /api/tooku → 已验证账号 → SQLite 用户文档
```

开发环境由 Vite 挂载业务 API 并固定转发 `/nd/rest`。生产 `server/index.ts` 同时提供静态页面、API 与代理，Docker 使用 Node 及持久化数据卷。直接填写完整 Navidrome 地址仍可使用，只保存本地；服务端身份、版本与备份约定详见 [服务端持久化](13-server-persistence.md)。

## 3. 源码与修改入口

| 职责 | 文件 / 目录 | 开发注意点 |
| --- | --- | --- |
| Provider 与 CSS 入口 | `src/main.tsx` | Router 内有 `Interactions`，QueryClient 由 Provider 注入；保持 StrictMode 下的清理 |
| 路由、常驻布局、快捷键 | `src/App.tsx` | 切页不能重建音频；弹窗、输入和分隔条操作不应触发播放快捷键 |
| 头部、搜索、头像菜单 | `src/components/WorkspaceHeader.tsx` | 唯一账户设置入口、快速切库、搜索输入法组合与防抖 |
| 通用歌曲表格 | `src/components/Common.tsx` 的 `TrackList` | 收藏、右键动作、空白处双击、顺序与权限回调；不要另建一套表格交互 |
| 列宽 | `src/components/TrackColumns.tsx` | 指针与键盘操作；预览宽度与提交偏好分离 |
| 右键菜单、图标提示 | `src/components/Interactions.tsx` | `useContextMenu()`、`data-tooltip`；弹窗内浮层、定位翻转和焦点恢复 |
| 基础弹窗和选择器 | `src/components/Modal.tsx`、`Select.tsx` | 原生 dialog 与 popover；不要退回未统一样式的控件 |
| 封面与头像 | `EntityArtwork.tsx`、`ProfileAvatar.tsx`、`AvatarEditor.tsx` | 歌单本地封面覆盖、加载失败回退；头像圆形预览，歌单与歌手图片方形预览 |
| 歌曲/歌手独立链接 | `src/components/TrackLinks.tsx` | 歌曲在底栏跳专辑，歌手跳歌手；不要把整组信息包成同一个链接 |
| 首页和搜索 | `src/pages/Home.tsx`、`Search.tsx` | 数据按当前曲库筛选，保留综合搜索分类和真实统计 |
| 收藏与内容筛选 | `src/pages/Collection.tsx`、`src/components/FilterPills.tsx` | 收藏/主页共用圆角胶囊筛选；收藏歌手复用 `ArtistGrid`；三类空状态仅显示“还没有收藏的歌曲/专辑/歌手” |
| 专辑与歌手页 | `src/pages/Library.tsx`、`ArtistDetail.tsx` | 专辑自动分批浏览；歌手横幅、播放与专辑区，保留当前库边界 |
| 全站滚动条 | `src/components/ContentScrollbar.tsx`、`ScrollArea.tsx` | 中部、左栏和播放侧栏叠加贴边 8 px 滑块；监听滚动和内容尺寸，支持拖动、键盘及清理；弹窗/菜单使用 `src/scrollbars.css` 原生回退 |
| 自动加载 | `src/components/AutoLoadMore.tsx` | 监听中部 `.content` 滚动容器；接近底部预读，失败时停止，卸载清理监听 |
| 歌单管理与详情 | `src/features/library/PlaylistViews.tsx` | 直接排序保存、随机播放、只读判断；详情通过 key 隔离每张歌单的编辑状态 |
| 歌单信息与选图 | `src/features/library/PlaylistDetailsEditor.tsx`、`PlaylistCoverPicker.tsx` | 详情封面直达选图/裁剪，三点菜单编辑名称/简介；名称/简介写 Navidrome，封面沿用 Tooku 账号同步 |
| 新建歌单 | `src/features/library/CreatePlaylist.tsx` | 左栏可选位置；管理页使用当前目录 |
| 左栏树和移动弹窗 | `src/features/library/Organization.tsx` | 与管理页共用组织数据；`pages/Playlists.tsx` 保留导出和添加歌曲入口 |
| 左栏文件夹拖放 | `src/features/library/useOrganizationDrag.ts`、`src/state/library.ts` | 横线排序、变色移入文件夹、末尾横线移到根目录；主体管理页不参与拖放 |
| API 与统一模型 | `src/api/client.ts`、`src/domain/models.ts` | HTTP/业务错误分开，DTO 转换集中；不要照抄旧文档示意字段名 |
| 播放引擎与算法 | `src/features/player/engine.ts`、`src/domain/queue.ts` | 单实例媒体、异步竞争、队列条目身份与有效收听 |
| 底栏与完整播放器 | `src/features/player/PlayerUI.tsx` | UI 发命令，不创建音频；展开界面只显示歌词，三点菜单集中歌曲操作 |
| 浏览器全屏 | `src/features/player/FullscreenButton.tsx` | 顶部/底栏复用；Fullscreen API 进入根节点、同步退出状态、重新提升原生弹窗，保持 DOM、查询与音频；不支持时禁用 |
| 桌面歌词 | `src/features/player/DesktopLyrics.tsx`、`desktop-lyrics.css` | 底栏按钮打开 Document Picture-in-Picture；Portal 共用歌词查询与状态，当前句原文/译文同步显示，静态歌词手动滚动；窗口位置由浏览器控制，保留用户拖动位置；关闭、切账号与迟到请求清理，不接管音频 |
| 播放侧栏 | `NowPlayingPanel.tsx`、`QueuePanel.tsx`、`PanelResizeHandle.tsx` | 正在播放/队列共用右栏；分栏拖动条由 App 放在面板间隙 |
| 歌词 | `src/features/player/Lyrics.tsx` | 独立滚动视口、按锚点对齐与首尾留白、空闲恢复和偏移换算 |
| 歌词来源与双语整理 | `src/features/lyrics/`、`src/domain/lyrics/`、`src/api/lyrics.ts` | 本地优先；来源/绑定/按歌修正共用，滚动状态独立；本地错误不触发自动补齐 |
| 网络歌词服务 | `server/lyrics/`、`NetworkLyricsSettings.tsx` | 同端口独立查询/检测、固定平台协议、受限缓存和真实观测；不依赖 Navidrome 会话 |
| 本机快照 | `src/storage/local.ts` | IndexedDB `tooku` / `profiles`；按身份分区的队列与历史 |
| 用户数据同步 | `src/storage/userSync.ts`、`src/features/settings/UserDataSettings.tsx` | 空端自动迁移/恢复、版本冲突、离线缓存、备份恢复；不得操作当前音频 |
| 后端与共享格式 | `server/api.ts`、`store.ts`、`index.ts`、`src/domain/userData.ts` | 固定上游认证、SQLite 原子 revision、限额与白名单 |
| 启动与部署 | `scripts/dev-server.mjs`、`scripts/port-selection.mjs`、`start-tooku.cmd`、`deploy/` | 有界端口回退、健康检查与复用现有服务 |

新增功能优先扩展这些边界，不要求为了符合早期“目录建议”搬动整个仓库。已有文件包含较长 JSX，新代码优先写清晰的组件和函数；拆分只服务当前任务。

## 4. 当前 UI 契约

### 布局与入口

头部是全局导航；主体为左侧导航/歌单树、中部浏览区、右侧播放内容，底部为常驻控制栏。窄屏使用覆盖侧栏，避免把主体压成不可用宽度。

- 主页图标左侧提供后退/前进，只遍历本次登录工作区已访问的页面；无可用历史时禁用，搜索替换不新增历史。主页图标只在当前主页显示选中效果，搜索栏尾部不显示回车图标。窄屏头部分为两行以保留搜索宽度。
- 设置通过头像菜单进入，菜单可快速切换真实曲库；右侧版块配置按钮不属于新增账户设置入口。
- 独立歌曲页已取消，旧 `/songs` 兼容地址转到 `/search?type=songs`。主页筛选为全部、歌单、专辑、歌手；歌手卡片复用 `components/ArtistGrid.tsx` 并进入现有歌手详情页。主页不显示底部曲库名与“浏览所有歌曲”小字。综合搜索保留歌曲分类，已有歌曲默认视图配置在主页回退到全部，不改写存储数据。
- 专辑页沿用每批 30 张的接口，在距中部滚动区底部 600px 时自动读取下一批，不显示“加载更多”按钮；小曲库自然读完，大曲库随滚动继续读取。延迟加载封面、跳过屏外卡片绘制，重复整页停止追加；后续批次失败保留已有内容，只由用户重试。
- 歌手列表保持圆形卡片；详情统一为柔化背景、方形前景图片、大号歌手名、播放/随机/收藏和专辑区。旧版私人图片仍优先展示；管理员原生会话可悬停/键盘聚焦显示“选择照片”，点击打开文件选择与共享裁剪弹窗。新图由 `MusicApi.saveArtistImage` 上传 Navidrome，读回核实后清除该歌手的旧私人覆盖；不批量迁移，不写 Tooku 账号文档。右键可恢复服务器默认、重新读取或移除旧私人图片。写入结果未知时停止写入，先“重新读取”再人工核实。歌手图使用 `getArtist` 明确返回的 `coverArt` 经 `MusicApi.coverUrl` 生成图片地址；缺图/图片失败依次尝试该歌手本库专辑封面、主题渐变；专辑封面以方形主体和柔化横幅展示，不作为真实歌手照。封面按稳定专辑 ID 选择，排除明确属于其他专辑歌手的记录，所有图片失败后停止重试。播放和专辑区使用纯色背景。所有路由的主浏览区隐藏原生滚动条，由 `ContentScrollbar` 在右缘叠加无箭头、透明轨道和 8 px 半透明滑块，贴边且悬停变亮，不占内容宽度，也不替换主滚动容器；左栏与播放侧栏复用 `ScrollArea`，弹窗、菜单、横向表格使用全站原生回退样式；支持轨道点击、拖动、方向键、翻页键及 Home/End。Navidrome 的图片源取决于服务端本地图与外部元数据设置，当前页面展示旧版私人图片与 Navidrome 图片，管理员可手动上传到 Navidrome，不存图片认证 URL；联网来源仅通过独立脚本试验，尚未自动接入页面。播放仅在主动点击后读取本库歌手专辑，全部成功后统一交给 `player`，切页/切库取消未完成操作。
- 底栏可显示当前歌曲的小封面；左栏底部不再放独立的大封面或额外暂停按钮。右侧操作依次为队列、音量、桌面歌词、全屏，桌面歌词紧邻全屏按钮左侧；桌面歌词通过浏览器画中画置顶，复用来源、译文/罗马音开关与偏移，外语原文和已有中文译文上下显示。没有时间轴时手动滚动，不伪造同步。请求初始 480 × 180，默认位置与拖动后的记忆由浏览器决定，网页无法强制右下角；需文档画中画支持和安全上下文（本机地址或 HTTPS），不支持/失败显示应用提示。浮窗不持久化打开状态，切页/切库不关闭或重建音频，切账号/退出登录/卸载时关闭，迟到窗口也会关闭。
- 右栏队列不是第二份播放状态；其“当前播放 / 接下来”应反映引擎真实队列。

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

沿用现有系统字体栈、圆角面板、克制阴影和短过渡。颜色来自 token，图标来自 Lucide；封面、歌曲和歌单是视觉主角。不要增加营销横幅、冗余小字、伪造推荐或随意使用品牌绿覆盖 Tooku 主题色。

复用 `IconButton` 的中文名称和应用 tooltip。使用 `data-tooltip` 提供其他提示，默认上方浮现、边缘翻转。统一菜单须在深浅主题中可读、可用 Esc 关闭、可通过键盘访问；弹窗内浮层不应被遮挡或变成不可点击。

展开播放器采用柔化封面铺底，左侧大封面、歌曲信息与播放控制，右侧大字歌词；不显示品牌、动态歌词标签、音频格式、普通播放状态和底部下一首预告等小字。左侧封面与控制区固定，按剩余空间缩放封面，内部列显式 `minmax(0, 1fr)`，元信息和控制区域宽度受限；超长歌曲名/歌手名用 `ScrollingText.tsx` 在单行区域内自动往返滚动，悬停/聚焦暂停，减少动态效果时手动横向查看。任何窗口尺寸下均不依靠左侧或整个播放器滚动；窄屏改为固定上下分区。布局按 CSS 可用宽高适配 1K / 2K / 4K 与浏览器缩放；封面、列间距和歌词字号使用有上下限的视口尺寸，主体最大宽度 2880 px，歌词阅读区最高为 64dvh / 1160 px，避免大屏铺满整屏。进度时间分别左、右对齐。来源、歌词设置、浏览器全屏和收起图标统一放在顶部一行，无胶囊外框，竖线分组；QQ 来源使用同色企鹅图标；歌词设置分为显示/版本两页，显示页不放预览；弹窗固定标题，内部内容滚动避开 12 px 圆角，输入框统一 44 px 高的主题表面与焦点边框，并在滚动层预留边框空间；显示页“自动识别”、重置/刷新同行、保存单独一行，版本页先输入歌曲标题与歌手，再选择平台并搜索，不放刷新；仅右侧歌词容器滚动，右上角收起；不放歌词/队列切换、音量或底部歌词设置；显示与版本调整集中在顶部歌词设置面板。展开页右键与收藏右侧三点按钮复用同一当前歌曲菜单，内部输入框保留文本编辑菜单；三点按钮复用统一菜单，可查看专辑、歌手、歌单，以及打开已有添加歌单弹窗；页面跳转时收起播放器，不改变音频。缺少专辑/歌手 ID 时尝试已有 song 查询补全，仍缺失则禁用对应入口；查看歌单只打开当前队列出现项的 `source.kind=playlist` 所指歌单；无来源时禁用，不跳总管理页，也不通过歌曲成员关系猜测播放来源。异常状态仍提供必要反馈。共用歌词仅在手动浏览时显示“同步”，闲置 5 秒后恢复自动跟随并收起按钮；展开页通过继承的 `--lyric-anchor: .42` 将当前歌词组中心放在阅读区中部略上，侧栏与窄屏为 .5；首尾使用独立 `--lyric-before` / `--lyric-after` 留白，使第一句、最后一句和换行长句也能对齐锚点。调整尺寸或字体后重新计算，不滚动整页。系统和应用的减少动态效果设置均需考虑。

歌手图片写回入口集中在 `src/api/client.ts`：登录时仅对 Navidrome 尝试 `/auth/login`，原生 JWT 与角色只留会话内存，退出清除；密码只传给登录请求。`POST /api/artist/:id/image` 使用 `image` multipart 字段，`DELETE` 恢复默认，写前/后均读取 `/api/artist/:id`。HTTP 权限错误由 Navidrome 最终裁决，不自动重放上传；确认后的预览仅留查询内存，等待上游构建图片。`server/navidromeProxy.ts` 为开发/生产共用路径及方法白名单，仅新增登录与歌手图片所需路由；不开放其余原生管理接口。原生认证失败不阻断 Subsonic 登录，旧版服务器或直连 CORS 配置不支持时无法编辑。协议参照 [Navidrome v0.64.1 上传实现](https://github.com/navidrome/navidrome/blob/v0.64.1/server/nativeapi/artists.go)。

## 5. 数据归属与当前限制

| 数据 | 当前保存位置 | 作用域 / 事实 |
| --- | --- | --- |
| 音乐文件、专辑、歌手、新上传的歌手图片、服务器收藏 | Navidrome | 以服务器授权和返回值为准 |
| 歌单名称、简介、曲目和曲序 | Navidrome | Tooku 通过协议读写并核实 |
| 头像、自定义歌单封面及旧版私人歌手图片 | SQLite 自动保存/恢复；localStorage 缓存：`tooku-profiles` | 本地按 `api.identity`，服务端按已验证 owner；旧版 data URL 不自动上传 Navidrome |
| 文件夹及展开状态、歌单位置/混排、曲库视图与选中库 | SQLite 自动保存/恢复；localStorage 缓存：`tooku-library-organization` | 内部按真实 `libraryId` 组织；不是音乐服务端目录 |
| 明暗、主题色、布局、列宽、歌词和快捷键偏好 | SQLite 账号文档 / IndexedDB sync；`tooku-preferences` 作为当前偏好与设备回退 | 切号还原设备回退，账号修改存在各自 sync 缓存 |
| 队列、暂停位置、历史 | SQLite 最后保存的账号快照 / IndexedDB | key 由 `identity` 与种类组成；下次登录暂停恢复，不实时接管播放 |
| 同步基线、未上传数据、导入前副本 | IndexedDB `profiles` 中 `sync` / `before-import` | 原数据保留；清除本机播放快照不清迁移基线 |
| 查询结果 | TanStack Query 内存 | 按身份与相关库隔离，不等于持久化服务端数据 |
| 登录密码、token/salt | 会话内存 | 刷新/热更新整页重载后需重新登录；不写入上述存储 |

当前 `MusicApi.identity` 使用 `${base}|${username}`。更换访问 origin、代理基址、账号写法或身份规则，可能让旧数据不可见；不能通过简单更名身份来解决串号问题。

Navidrome 的 `getPlaylists` 返回账号可见的歌单。每库归属是 Tooku 的 `placements`，不能把它误当成协议天然返回的每库独立歌单集合。`getArtist` 可能聚合多个曲库，当前有专辑边界过滤，不能为了少发请求直接删除。

清理站点数据、更换浏览器/设备、访问 origin 变化会影响本机数据；IndexedDB 也受此限制。已上传的数据可经同一 Tooku 部署、同一固定上游账号恢复。服务器空时自动上传原浏览器数据，新浏览器本地空时自动读取；只有两端均有不同个性数据或待核实结果时需预览选择。默认库 ID 与空队列不阻断同步，已经同步的账号删除操作仍需保留。同步缓存新增可选 `requiresReview` 字段，兼容旧版 v1 缓存。自动保存遇到冲突停止，不做字段合并。设置支持账号 JSON 导出/恢复，管理员使用 `npm.cmd run backup -- <新文件>` 做完整 SQLite 在线备份。详细边界见 [服务端持久化](13-server-persistence.md)。

### 持久化的维护约束

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
| `src/components/filter-pills.css` | 主页/收藏共用圆角筛选，含选中、悬停、窄屏与减少动态效果 |
| `src/pages/album-browse.css`、`artist-detail.css` | 专辑自动加载表面、歌手横幅及详情布局 |

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

最近已记录基线：2026-10-19 构建、Lint、59 项测试 / 10 个文件通过；有真实登录、界面与播放的部分检查，但没有完整移动实机、音频格式、长期播放或 Docker 验收。最新执行结果应在当前任务重新说明，不能引用旧记录充当新结果。

用户目前偏好少量基础错误验证，详细效果留给人工。最终回复直接列出本次需要看的几项，不新建手工验收文档。纯文档改动检查链接、事实和 diff 即可。

歌手联网来源的公开样本试验见 [歌手图片补齐试验](14-artist-artwork-experiment.md)。`scripts/probe-artist-artwork.ts` 仅做独立命令行联网试验，结果写入 `.local`；用户已决定暂不接入网络补图；页面尚未自动采用外部候选，不能将试验覆盖数当作匹配正确率或已经接入的功能。

## 9. 常见任务的最短路径

- **改全局布局**：`App.tsx` / `WorkspaceHeader.tsx` → `workspace.css` → 核对紧凑侧栏和底栏；避免重建音频。
- **改歌曲操作**：`Common.tsx` 的 `TrackList` → `useContextMenu` / 列宽组件 → 必要的列表交互测试。
- **改歌单或目录**：`PlaylistViews` / `Organization` → `state/library.ts` 或 `MusicApi` → 判断本地修改还是服务器写入 → 验证重复项、权限、并发与库边界。
- **改歌词**：`Lyrics.tsx` → 对应播放器样式 → 几何与时间换算测试；保留“同步”和 5 秒空闲恢复。
- **修启动**：先看 `.local/server-url.txt`、健康端点和启动日志 → 启动器/代理；不要先改系统网络或停止 Navidrome。
- **加持久化**：先梳理本指南的数据表与当前 namespace → 设计迁移和身份验证 → 再实现存储/接口，不把 IndexedDB 改名成“服务端数据库”。

## 10. 维护规范本身

入口、数据归属、Provider、缓存身份、启动命令或主要交互改变时，同步更新 [AGENTS.md](../AGENTS.md)、本指南和 README 中受影响的段落。测试数量与版本记录需要日期；未测试的能力明确标注。维护历史文档时添加版本提示，不把已经发生的验证记录改写成不存在的结果。

## 11. 网络与双语歌词

[独立歌词组件方案与实现](15-lyrics-service-design.md) 描述当前接口与维护边界。Tooku 自己维护网络检索、匹配、缓存、状态与共用双语整理；Navidrome 仅为现有本地输入渠道。来源仅本地、网易云和 QQ，默认本地优先、明确缺失时自动联网并采用相近版本，允许事后修正；本地只有外语原文时仍保留本地，不自动替换成网络版本。纯音乐、占位或最终无正文统一显示“该音乐没有歌词，请欣赏”，网络真实错误仍保留在服务状态。

`MusicApi.lyrics` 保留结构化多轨与普通 LRC 原文；`normalizeLyrics` 负责毫秒时间轴、Unicode 多语言、结构化字段换行和四类双语格式；`domain/lyrics/matching.ts` 为前后端共用的匹配规则，比较歌手前兼容多人分隔、括号及平台 `artistAliases` 别名，保留歌名、时长、演出版本约束；网易云在既有搜索预算内最多补读两位歌手的固定 ID 译名，内存缓存 40 位 / 1 小时，失败保留候选；修改决策规则时更新前端网络查询代次，避免复用旧空结果，不清个人绑定或原始平台缓存。`useLyrics` 复用 Provider / QueryClient，按账号、曲目、元数据、来源、绑定和刷新代次隔离查询；歌词正文共享，两个视口独立滚动。切源与切歌取消过期前端请求，迟到结果不覆盖新曲目，不操作音频。

网易云无可信组合检索结果时，在同一搜索预算内仅追加一次歌名检索，合并排序后最多返回 10 项，仍校验歌手与时长；候选演唱者展示列表最多保留 20 位，避免无关合唱元数据阻断整批。QQ 固定新版 musicu 明文模式显式请求译文（trans=1 / crypt=0），协议或暂时故障回退旧接口，限流/登录要求不回退；无新解密或认证依赖。搜索缓存 v3、QQ 正文 v2，前端同步升级策略 key，保留个人选择与旧缓存。

网络客户端只访问同源 `/api/lyrics/{health,status,search,fetch,check}`，开发/生产使用同一 handler。服务无需 Navidrome 登录；同源检查不等于身份认证，不返回个人绑定。平台域名、ID、大小和速率受限，部署总开关为 `TOOKU_LYRICS_ENABLED=false`。设置开关是当前账号的策略，服务状态不在后台频繁探测。

账号文档新增可选 `lyrics`；`src/state/lyrics.ts` 提供本机按 identity 隔离回退，接入现有 revision、IndexedDB sync 与导出/恢复。旧备份缺少字段时重置当前账号歌词选择，保留其他账号。平台缓存为数据目录独立 `lyrics-cache.sqlite`，不进入账号备份；缓存故障退回内存，不清用户数据库。

基础测试：`lyrics-normalize.test.ts`（四类格式/歧义/时间配对）、`lyrics-service.test.ts`（适配器/缓存/HTTP/状态）、`lyrics-source.test.tsx`（选择/回退/迟到/双视图）、现有 API/播放器与用户同步测试。`node scripts/probe-lyrics.ts` 仅请求公开样本，摘要写入被忽略的 `.local/lyrics-probe.json`，不输出歌词正文或凭据。

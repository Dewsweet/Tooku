# Navidrome 接口对接

> 历史协议基线：下文保留早期接口调研与契约，当前适配、权限和降级以 `src/api/client.ts` 及相关测试为准。歌手图片现已使用白名单内的 Navidrome 原生管理员 API；独立歌词/推荐及 Tooku 用户数据不属于 Subsonic，入口和边界见 [开发接入指南](12-agent-development-guide.md)。无账号探测不能证明真实写入权限或全部能力可用。

基线服务：`http://127.0.0.1:44533`，本轮观测版本 `0.64.1 (285dc4f3)`。以下为早期实现契约，未登录的检查不证明下列业务接口已联调。

主要依据：[Navidrome 兼容性表](https://www.navidrome.org/docs/developers/subsonic-api/)、[Subsonic API](https://www.subsonic.org/pages/api.jsp)、[OpenSubsonic 扩展](https://opensubsonic.netlify.app/docs/extensions/)。首版使用公开音乐协议，不依赖 Navidrome 原界面的旧内部接口或仍在设计的 API v1。

## URL 与传输

服务地址必须保留协议、端口和 base path。例如 `https://music.example/navidrome` 对应 `https://music.example/navidrome/rest/ping.view`，不能用以 `/rest` 开头的 URL 拼接丢掉子路径。

只接收 http/https 地址，拒绝 URL 内用户名密码、fragment 和未知 query；去除尾斜杠后在统一 transport 中追加 `/rest/{method}.view`。本机默认提示地址；手机上的 127.0.0.1 指向手机自身，需改为服务所在设备的局域网地址或通过同源代理访问。

一般 JSON 请求携带 `v=1.16.1`、`c=Tooku`、`f=json`。业务参数使用 URLSearchParams 编码；多个 songId/id 使用 append，不能丢掉重复键。音频/封面为二进制响应，不走 JSON 解包器。

普通 API GET 先用于兼容性基线；探测 `formPost` 支持后可改为 application/x-www-form-urlencoded POST，尤其大歌单写入。不能仅凭 POST 返回 HTTP 200 就认定扩展可用。封面在受管连接中使用同源 Cookie 代理；音频先通过 `/api/tooku/playback` 换取临时同源路径，由 `/api/tooku-stream/{grant}` 在服务端注入认证。直连其他 Navidrome 时音频/封面 URL 仍需协议认证参数；同源地址本身不会自动消除认证，不能把直连 URL 持久化或输出到日志。

## 登录与认证生命周期

P0 使用用户名 + token/salt；P1 可增加 API key 登录。

1. 用户在登录页输入服务地址、用户名和密码。密码不进入可持久化 store 或日志。
2. 使用密码原始值和随机 salt，按协议计算 `t=md5(password + salt)`；`u` 为用户名、`s` 为该 salt。不修剪密码，不把密码先 MD5 再参与计算。
3. 用相同 credential 对 ping 发认证请求，检查 HTTP、JSON envelope 和业务 status。
4. 成功后保留 u/t/s 的内存组合并丢弃密码；该组合可继续发请求，也是敏感凭据。不在没有密码时擅自换 salt。
5. 检测扩展、库权限并加载当前身份范围的数据；仅连接到新服务/新用户后再恢复该范围队列。
6. 认证失效时停止自动请求和重试，暂停播放器并让用户重新登录；退出时先停音频、清 src、取消请求和事件，再清内存凭据与用户缓存。

MD5 仅用于协议互操作。Web Crypto 的 digest 没有 MD5，M0 选一个经过核对、支持 UTF-8 的小型实现，并用中文密码/非 ASCII salt 的测试向量验证；远程传输使用 HTTPS。

[API key 扩展](https://opensubsonic.netlify.app/docs/extensions/apikeyauth/)使用 `apiKey` 参数；不得同时发送 u、p、t、s。服务生成/撤销 key 的方式不由协议统一规定，Tooku 不代替服务器创建 key。API key 支持和稳定用户标识需实测后启用；首版不能强制所有用户使用它。

## 能力检测

认证后的 `getOpenSubsonicExtensions` 返回名称和版本数组。保存“声明支持”与“实际探测成功”两种信息，避免一个坏扩展阻塞基础播放。未知扩展忽略，暂时失败不永久写成“不支持”。

| 能力 | 声明/验证方式 | 降级 |
| --- | --- | --- |
| JSON 与认证 | ping envelope | 给出错误，不进入假登录状态 |
| 多音乐库 | getMusicFolders | 无可访问库显示空状态；不能列出未授权内容 |
| 服务端逐行歌词 | songLyrics v1 + getLyricsBySongId 样本 | getLyrics 静态文本 → 无歌词 |
| 逐词/翻译/注音 | songLyrics v2 + enhanced=true 的真实曲目 | 逐行；v2 存在不意味着每首歌都有 cue |
| 表单 POST | formPost + 小型只读请求 | 使用 GET；过大写入提示限制，不能静默截断 |
| 播放状态报告 | playbackReport + reportPlayback | scrobble 的传统 now playing/提交策略 |
| 索引队列 | indexBasedQueue + getPlayQueueByIndex | 传统队列；重复曲目当前项可能有歧义 |
| API key | apiKeyAuthentication + 用户提供 key 的认证结果 | 用户名 token/salt |
| 转码与 seek | 原始流/兼容流样本，检查时长与实际跳转 | 切兼容流或解释不可 seek；不全局禁用原始流 |

权限与扩展不同：有歌单接口不代表可改任何歌单；有下载/分享接口不代表当前用户被允许使用。写权限通过服务返回及目标所有权判断，不能只看公开网页配置。

## 功能与接口映射

| 功能 | 接口与关键参数 | 约束 |
| --- | --- | --- |
| 首页专辑 | getAlbumList2：type=newest/random/frequent 等、size、offset | 以实际库内容为准，分区失败可单独降级 |
| 专辑/歌手 | getAlbum(id)、getArtists、getArtist(id)、getSong(id) | ID 一律字符串，区分歌手/专辑/曲目对象 |
| 搜索 | search3(query)、artist/album/songCount 与各 offset | 分类别分页；不假设服务端拼音或 Lucene 支持 |
| 封面 | getCoverArt(id,size) | 取 coverArt 字段作为 ID；缺失使用占位 |
| 播放 | stream(id)，按需 format/maxBitRate | 请求参数不是已确认输出格式，需检查可用证据 |
| 收藏 | getStarred2、star/unstar：id/albumId/artistId | 不同资源用对应参数；失败回滚 |
| 普通歌单 | getPlaylists、getPlaylist(id)、createPlaylist、updatePlaylist | 串行保存、重新读取、检查权限与顺序 |
| 删除歌单 | deletePlaylist(id) | 单独明确操作；联调只作用于专用测试歌单 |
| 传统歌词 | getLyrics(artist,title) | 同名曲可能匹配不准，优先按歌曲 ID 的扩展 |
| 结构化歌词 | getLyricsBySongId(id)，v2 时 enhanced=true | 全部时间统一到毫秒；译文和注音不混进主轨 |
| 收听 | scrobble(id,time,submission) | 读取流不等于记作已播放；提交一次且去重 |
| 播放报告 | reportPlayback：mediaId/mediaType/positionMs/state/playbackRate | ignoreScrobble=true 与显式 scrobble 配合，避免重复计数 |
| 传统队列 | getPlayQueue、savePlayQueue：重复 id、current、position | position 毫秒，current 是歌曲 ID，重复项有歧义 |
| 索引队列 | getPlayQueueByIndex、savePlayQueueByIndex | 按扩展指定当前索引；保留重复曲目次序 |

首版客户端不直接调用 Last.fm/ListenBrainz 上报，交给 Navidrome 已配置的服务处理，避免双重提交。

## 歌单编辑协议

[createPlaylist](https://opensubsonic.netlify.app/docs/endpoints/createplaylist/) 用 name 新建，用 playlistId 更新，并用重复 songId 指定曲目列表。[updatePlaylist](https://opensubsonic.netlify.app/docs/endpoints/updateplaylist/)负责名称、公开状态及曲目增删等；删除项参数是列表位置，不能传 trackId 代替。

重排先读取原始快照及 changed（如有），编辑草稿，然后检查服务端是否已变更，再通过已验证的整列表更新保留重复项；保存后 getPlaylist 对照。changed 检查不是原子 CAS，其他客户端仍可能在检查后改动，因此不能声称绝无并发冲突。服务不支持可靠重排时展示限制，不以“先删歌单再新建”代替。

空歌单、重复歌曲、多个移除索引、长歌单与权限失败都需契约测试。未知结果的超时先重新读取，不自动重复追加；新建歌单超时须检查现有列表，不能不断重试创建。

## 歌词 v2 适配

[官方接口说明](https://opensubsonic.netlify.app/docs/endpoints/getlyricsbysongid/)定义 kind、line、cueLine 与逐词 cue。UTF-8 byteStart/byteEnd 不能直接作为 JavaScript 字符串的 UTF-16 slice 下标；优先使用 cue.value，确需还原时按规范处理字节边界，并用中文、Emoji、组合字符验证。

语言字段保留原值，并把 xxx/und 当未指定；不强制符合两位语言码。[structuredLyrics 规范](https://opensubsonic.netlify.app/docs/responses/structuredlyrics/)的正 offset 表示提前显示，因此适配到内部正值表示延迟的模型时要取反。主歌词、译文与注音按时间/轨关联，不能只按数组下标假定一一对应。无可用逐词时间戳时保持逐行显示，不平均分配字符时间伪造“逐词”。

## 错误、重试与诊断

| 层 | 处理 |
| --- | --- |
| 网络超时/断网/CORS | 只读请求有限重试（建议 2 次、退避）；取消和认证失败不重试 |
| HTTP 非 2xx | 读取可解析错误，保留状态但去除敏感 URL；不要无限循环登录 |
| HTTP 200 + status=failed | 映射 code/message 为类型错误；本地未认证 ping 就属于此情况 |
| 内容不是 JSON/被代理重定向到 HTML | 显示“接口被登录页或代理拦截”，不伪装成密码错误 |
| 权限/资源不存在 | 显示目标不可访问并失效对应缓存；不影响其他页面 |
| 音频错误 | MediaError 未必带业务 code；按音频状态与独立只读诊断判断，不把 token URL 输出给用户 |
| 写入超时 | 状态标记待核实，重新读取；不能套用只读请求的自动重试 |

所有 DTO 边界处理可选字段、缺失数组、空字符串与非有限数值。duration 未知时保持未知，不显示 NaN 或误判已结束。

## 本地联调记录模板

| 检查 | 当前结果 | 下阶段证据 |
| --- | --- | --- |
| 根页/未认证 ping | 已确认可达，业务失败符合缺凭据状态 | README 中版本信息 |
| 认证与扩展列表 | 待测 | 脱敏 envelope，扩展名称/版本、账号权限类别 |
| 曲库/封面/分页 | 待测 | 样本规模、字段差异、浏览器请求结果 |
| 原始/转码音频与 Range | 待测 | 格式、响应头、seek 实际结果 |
| 歌词逐行/v2 | 待测 | 授权样本或脱敏结构，时间和 Unicode 结果 |
| 收藏/歌单写入 | 待测 | 专用测试歌单前后结果与清理记录 |

记录不保存密码、token、真实签名 URL 或未经用户允许的私人曲库导出。

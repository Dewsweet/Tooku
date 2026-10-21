# 音乐推荐

更新：2026-10-21。首版实现记录，不代表所有模型、平台目录和地区均已真实联调。

## 入口与行为

左栏“最近在听”下方为“推荐”，路由 `/recommendations`。从头像进入设置，在“音乐推荐”中配置服务。只有“生成推荐 / 换一批”才调用模型；每批最多 10 首，保留最近一批，失败或没有新候选时保留旧结果。平台链接核实独立进行，核实前可搜索歌曲。

每首显示歌名、歌手、可用专辑信息、推荐依据和四个平台入口。核实到封面时显示，否则使用音乐图标，不虚构图片。当前曲库播放须先查询、匹配版本，再交给既有播放器；外部平台音频不进入 Tooku 队列。

## 模块

| 入口 | 职责 |
| --- | --- |
| `src/domain/recommendations.ts` | 类型、运行时白名单、历史整理和平台 URL 校验 |
| `src/state/recommendations.ts` | 按账号持久化设置/批次；独立会话密钥内存状态 |
| `src/api/recommendations.ts` | 同源请求、取消、输出校验；密钥不进入查询 key |
| `src/features/recommendations/` | 推荐页、生成、平台链接及本库播放 |
| `src/features/settings/RecommendationSettings.tsx` | 偏好、凭据、模型与分别检测 |
| `server/recommendations/service.ts` | Last.fm / AI 候选、核实、筛选和降级 |
| `server/recommendations/catalog.ts` | 四平台目录；国内搜索复用固定目录适配器，不读取歌词 |
| `server/recommendations/network.ts` | 模型 HTTPS、公网 DNS 固定、限额及错误脱敏 |
| `server/recommendations/http.ts` | HTTP 白名单、同源、限流、并发和断开取消 |

开发与生产挂载同一套 handler，无新增依赖、进程或端口。共享歌曲比较规则位于 `src/domain/lyrics/matching.ts`，现支持通用目录元数据，既有歌词策略不变。

## 样本与推荐

从最多 200 条有效收听记录中提取最近 30/40/50 首不同歌曲；仅分析时聚合，原始历史不变。重复次数的权重增益递减、总权重最多 5；时间权重以 14 天为半衰期。发送标题、歌手、专辑、可用时长、次数与权重，不发送账号、歌曲 ID、认证 URL、音频或歌词。

算法模式使用 Last.fm `track.getSimilar`。按权重选最多 8 位不同歌手的代表歌曲，每首最多 20 个候选，合并后最多 80 个。混合模式将最多 60 个候选交给模型排序；只接受已有候选 ID，不允许模型替换元信息或生成 URL。

AI 模式或混合模式缺少 Last.fm 候选时，模型可提名最多 20 首，必须经网易云、QQ 或已配置的 Apple Music 核实；使用正式元信息重新归一化 ID，无法核实的略过。AI 失败且有候选时回退算法并显示状态；候选不足允许少于 10 首或空结果，不填造数据。

支持兼容 Chat Completions 的公网 HTTPS 接口：基址自动追加 `/chat/completions`，也可填完整地址；请求使用 `model`、`messages`、`temperature`、`max_tokens`。要求返回 JSON，兼容 Markdown JSON 代码块。不同模型的参数和响应能力需分别检测。

过滤当前样本与上一批歌曲，同一歌手最多两首。探索比例优先分配熟悉/新歌手，候选不足时按实际结果补足，不是音频风格识别或精确多样性保证。原因来自种子关联或明确标注的 AI 推荐，不生成虚假的音频特征分析。Spotify 目录仅在推荐后用于链接核实，返回内容不输入模型。

## 平台与配置

| 服务 | 配置 | 用途 |
| --- | --- | --- |
| Last.fm | API Key | 相似歌曲；检测使用固定公开样本 |
| AI | 地址、模型名、API Key | 提名/排序；检测仅发送短提示 |
| 网易云 / QQ | 固定公开目录，无账号 Cookie | 版本匹配和歌曲链接 |
| Apple Music | 可选 Developer Token、商店地区（默认 cn） | 官方目录与歌曲 URL |
| Spotify | 可选 Client ID / Client Secret、市场地区（默认 US） | Client Credentials 临时令牌及官方搜索 URL |

使用歌名、歌手（含来源别名）、专辑、时长、Live/翻唱等版本信息匹配。直达链接限定固定 HTTPS 平台主机和歌曲路径，拒绝任意 URL 和认证查询参数。未配置、限流、故障、无匹配时显示带“搜索”标记的入口。目录命中不保证该地区的播放权限。

## HTTP、凭据与限制

| POST 路径 | 输入 | 输出 |
| --- | --- | --- |
| `/api/recommendations/generate` | `settings, credentials, seeds, excluded` | `RecommendationBatch` |
| `/api/recommendations/links` | `settings, credentials, songs` | 每首的链接和可用封面 |
| `/api/recommendations/check` | `settings, credentials, target` | 当次连接结果 |

输入最多 96 KB、上游响应读取最多 1 MB；每 IP 每分钟最多 16 次操作，全服务最多 4 个在途操作。Last.fm 并发 3、目录并发 4。来源预算 6 秒、模型 18 秒、AI 核实 20 秒、生成总计 65 秒，链接/检测 20 秒。不自动重试生成；客户端断开或服务退出取消在途工作。超时平台保留搜索入口，其他结果不受影响。

密钥、Client Secret、Developer Token 和 Spotify 临时令牌仅会话/请求内存，不写 localStorage、IndexedDB、SQLite、备份、日志或查询 key。切换 MusicApi 会话时清除密钥，页面卸载取消工作，迟到结果不能写入其他账号。模型调用仅携带模型密钥，平台凭据仅发往对应固定主机；上游错误采用固定文案，不返回原始响应。

服务端不保存账号配置、密钥或共享个人生成缓存。此接口与网络歌词一样是同源限流服务，不依赖 Navidrome 会话认证，公开部署沿用外层访问控制。完整地址直连 Navidrome 时推荐仍可用，个性数据仅保存本机。

模型地址限定无用户名/密码/查询/片段的 HTTPS 默认端口。所有解析结果必须为公网地址，将验证 IP 固定到实际连接，拒绝私网、回环、保留地址和重定向，避免作为任意代理。

## 保存与兼容

账号文档 v1 新增可选 `recommendations: { settings, batch? }`。普通设置与最近一批的最少元数据、依据、生成时间随既有账号文档同步、备份和 revision 冲突处理；密钥不在白名单。模型地址不能夹带认证信息。平台返回的 URL、目录正文、封面与临时令牌不进入账号文档；平台查询结果仅缓存 5 分钟。

本机 `tooku-recommendations` 按旧 `api.identity` 保存回退，读取时验证。默认状态不创建空账号记录。旧文档/备份继续有效，明确恢复旧备份会重置当前账号推荐数据，保留其他账号。无 SQLite schema 或文档版本升级，不清空旧存储。保存失败时会话保留可见状态并提示核实同步或导出备份；同步/恢复不操作音频。

## 协议与验证

自行编写适配，无新依赖、未复制参考代码：

- [Last.fm track.getSimilar](https://www.last.fm/api/show/track.getSimilar)
- [Apple Music 请求与响应](https://developer.apple.com/documentation/applemusicapi/handling-requests-and-responses)
- [Spotify Client Credentials](https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow)、[Search](https://developer.spotify.com/documentation/web-api/reference/search)、[Developer Policy](https://developer.spotify.com/policy)
- 国内固定目录沿用 [歌词组件维护记录](15-lyrics-service-design.md) 的自行实现与许可边界。

测试使用合成历史、模型和平台固定响应、隔离 HTTP/数据库，覆盖模式、回退、核实、版本、URL/DNS、凭据排除、账号切换、备份恢复和显式本库播放。没有使用用户密钥调用真实模型、Last.fm、Apple Music、Spotify，也没有修改真实歌单。推荐质量、实际权限、地区覆盖和视觉仍需人工查看，交付回复直接列人工查看项。

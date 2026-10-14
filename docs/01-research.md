# 项目调研与方案取舍

调研日期：2026-10-13。以项目作者仓库和官方协议文档为依据；以下功能是上游说明，未在本地逐一体验。动态网页与默认分支会变化，真正引入代码时需记录 commit、包版本与 LICENSE。

## 参考项目

| 项目与一手来源 | 已核对的特点 | 本项目借鉴与边界 |
| --- | --- | --- |
| [Feishin](https://github.com/jeffvli/feishin) | Navidrome / OpenSubsonic 客户端；Web 与桌面版本；歌词和智能歌单；GPL-3.0 | 借鉴成熟客户端的功能组织和接口适配；网页版本仅使用 Web 播放后端，不能继承桌面 MPV 的音频能力 |
| [Aonsoku](https://github.com/victoralvesf/aonsoku) | React / Electron；有 Web 与 Docker；服务端歌词缺失时可找 LRCLIB；MIT | 最适合参考 Web 工程组织与歌词回退；若复用代码，逐文件核对版权与依赖 |
| [Airsonic Refix](https://github.com/tamland/airsonic-refix) | 响应式 Web；持久队列、拖拽歌单、Media Session；AGPLv3 | 借鉴轻量自托管和队列交互；不把其播客支持等同于 Navidrome 的服务能力 |
| [SPlayer](https://github.com/SPlayer-Dev/SPlayer) | 中文播放器；Navidrome 等媒体服务、逐字歌词、封面取色、PWA；AGPL-3.0；README 标明维护模式 | 参考中文音乐产品的交互与视觉，避免引入整套平台账号/API 依赖；其后续项目需另行调研 |
| [YesPlayMusic](https://github.com/qier222/YesPlayMusic) | 第三方网易云播放器 | 用作专辑展示与页面层次的视觉参考；本轮不将其列为已验证的 Navidrome 接口实现 |
| [AMLL](https://github.com/amll-dev/applemusic-like-lyrics) | 歌词渲染库，有 React / Vue 绑定；AGPL-3.0 | 逐词歌词与氛围背景的候选依赖；它不是音频引擎，也不会自动提供匹配歌词 |
| [APlayer](https://github.com/DIYgod/APlayer) | HTML5 播放器组件 | 可参考轻量播放器交互；全局队列与媒体服务适配仍需自己设计 |

不使用星数排名判断适合程度。国内平台登录、桌面歌词和原生音频能力不属于独立网页客户端的默认能力。

## 协议与浏览器依据

| 来源 | 对方案的影响 |
| --- | --- |
| [Navidrome 兼容性](https://www.navidrome.org/docs/developers/subsonic-api/) | 基线为 Subsonic 1.16.1；ID 按字符串处理；文件夹树是模拟视图；搜索不支持完整 Lucene 语法；只请求 stream 不会自动记作已播放 |
| [OpenSubsonic 扩展](https://opensubsonic.netlify.app/docs/extensions/) | 登录后检测扩展及版本，按能力启用功能 |
| [歌词接口](https://opensubsonic.netlify.app/docs/endpoints/getlyricsbysongid/) | songLyrics v2 的 enhanced=true 可返回逐词 cue 和翻译/注音轨；实际服务与曲目数据必须分别验证 |
| [Navidrome API v1](https://www.navidrome.org/docs/developers/api-v1/) | 官方当前标记设计中、可能变化；不要当作首版稳定依赖；与旧内部 API 区分 |
| [Subsonic 认证规范](https://www.subsonic.org/pages/api.jsp) | 支持用户名、salt、MD5 token 等协议参数；协议哈希不替代 HTTPS |
| [Media Session](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API) | 媒体键/系统控制依能力启用，不承诺所有浏览器等效支持 |
| [自动播放规则](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay) | 首次播放需用户动作，并处理 play() 被拒绝的情况 |
| [Service Worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) | PWA 壳缓存和离线音频是不同工作项；部署需考虑安全上下文 |

LRCLIB 的 [官方文档入口](https://lrclib.net/docs) 在本轮检索中未返回可读正文。因此仅列为后续歌词提供方候选，接入前验证 API、浏览器访问、限流、许可和国内可达性；不宣称已联调。

## 决策：独立开发，保留适配器边界

建议独立构建 Tooku 的页面和播放器核心，以公开协议连接 Navidrome。这个选择是基于项目目标的工程判断：目前目录为空、目标集中于网页与中文体验，直接 Fork 会同时继承原有视觉、桌面打包和状态管理负担。

| 路线 | 成本与优势 | 适用条件 |
| --- | --- | --- |
| 新建 Web 客户端（推荐） | 产品自由度高；需要实现认证、队列和完整播放生命周期 | 需要长期维护独立产品 |
| Fork Aonsoku | 协议/页面基础可参考；需裁剪并验证依赖和运行环境 | 优先缩短原型时间，可接受沿用上游结构 |
| Fork Feishin | 功能成熟；改动范围与协议适配较复杂 | 需要桌面端与成熟功能集，并接受对应许可路线 |
| 修改 Navidrome 原 UI | 与上游版本、构建和内部接口紧密耦合 | 明确希望维护服务端 Fork，而非第三方播放器 |

首版不引入自建业务服务器。静态前端搭配部署侧同源反向代理足够支持本地音乐库；在线歌词、跨设备偏好同步等如果需要服务，再按独立需求增加。

## 代码与素材复用记录

调研阶段没有复制上游代码、图片或字体，也没有为 Tooku 落定 LICENSE。当前开发版独立实现页面和播放逻辑，生产依赖的随包许可已记录到根目录 THIRD_PARTY_NOTICES.md。许可证标识来自上游仓库，不将非作者网站的“MIT”等描述作为依据。

引入依赖前建立 `THIRD_PARTY_NOTICES.md`：来源、固定版本/commit、许可证、使用文件、版权说明。默认先实现简单逐行歌词；AMLL 进入独立技术验证阶段。若决定引入 AMLL 或直接派生其他项目，再核对完整许可文本并选择兼容发布方案；不预设可以采用 MIT。这里记录工程发布条件，不代替许可文本。

## 调研限制与待验证

没有 Navidrome 账号，故未读取私人曲库。未测媒体 Range、转码、歌词 v2、API key、写权限和跨设备队列；也未对参考项目做实机性能比较。登录后的能力与曲目样本应在 M0 补充到接口文档中，不能依据版本号直接填“支持”。

---
version: 1.0-approved
generated_at: 2026-09-07T11:25:46+08:00
updated_at: 2026-09-07T14:53:35+08:00
status: 已审核，开发中
approved_at: 2026-09-07T17:14:31+08:00
depends_on: ../prd/daily-knowledge-timeline-20260907.md
---

# 每日知识时间树网站设计文档

## 1. 设计摘要

本设计采用一个 TypeScript 全栈应用承载公开网页、网页管理后台与上传 API，以 SQLite 保存文章、栏目、当前及上一版本、媒体引用、TTS 任务和审计记录，以本地持久化目录保存重新编码后的图片与 MP3。应用运行在本地 Linux 物理机上，经 FRP 连接公网服务器，并由公网反向代理在 `https://codis.fun/Daily/` 提供 HTTPS 服务。

视觉主题暂定为 **“夜色中的知识年轮”**：深色背景上一条明亮但不刺眼的纵向树干贯穿页面，日期是年轮节点，栏目是带稳定主题色的分枝，文章是具有轻微生长动效的叶片卡片。它应首先是可读的信息界面，其次才是动态视觉作品。

本文是设计草案。所有标为“待确认”的内容不会在用户审核前固化为实现。

## 2. 技术方案

### 2.1 推荐技术栈

| 层 | 选择 | 原因 |
|---|---|---|
| 应用框架 | 支持服务端渲染和 Route Handler 的 TypeScript 全栈框架 | 页面、上传 API、元数据和错误处理共用一个 npm 项目 |
| UI | React + CSS 变量 + 少量客户端交互组件 | 时间树可渐进增强，正文和首屏仍可服务端输出 |
| 数据校验 | 共享的运行时 schema 校验 | 上传 API 与内部类型保持一致，返回字段级错误 |
| 数据库 | SQLite，启用 WAL；通过迁移管理 schema | 适合首期单机、零外部依赖、易备份和 Docker 卷挂载 |
| HTML 处理 | 服务端 HTML 解析器 + 明确允许列表净化器 | 不依赖浏览器执行上传内容，规则可版本化与测试 |
| 图片处理 | 受限下载器 + 栅格图解码/重新编码 + 内容寻址存储 | 转存远程图片，同时控制 SSRF、伪装格式和解码炸弹风险 |
| 正文与语音 | DOM 正文提取器 + SQLite 持久任务 + TTS Provider Adapter + FFmpeg | 上传后异步生成 MP3，供应商切换不侵入文章与播放器代码 |
| 后台认证 | 独立管理员密码 + 服务端会话 | 与所有智能体共用的上传密码隔离，避免上传权限升级为管理权限 |
| 测试 | 单元测试 + API 集成测试 + 少量端到端测试 | 覆盖净化、认证、分类、幂等和核心浏览链路 |
| 部署 | npm scripts + 多阶段 Docker 构建 + Compose | 满足两条部署路径且产物一致 |

实现阶段再锁定具体依赖版本，以受支持版本和锁文件为准；设计不绑定尚未生成的版本号。

### 2.2 为什么首版不拆成多个服务

- 当前核心负载适合一个主机和一个应用代码库；Web 与 TTS Worker 可以作为两个本地进程共享 SQLite 和持久目录。
- 单仓库共享上传 schema、栏目类型和错误码，减少智能体接入偏差。
- npm 与 Docker 运维更直接。
- 安全边界依靠认证、净化、内容安全策略和数据库权限，而不是为拆分而拆分。

当出现多机部署、大文件对象存储、高并发语音队列或独立审核系统时，再拆成可联网的独立服务。

## 3. 系统上下文

```text
┌──────────────────┐       HTTPS + 共享 Bearer 密码     ┌─────────────────────────┐
│ 上传智能体 A/B/C │ ─────────────────────────────────▶ │ 文章摄取 API             │
└──────────────────┘                                    │ 校验 → 图片转存 → 净化     │
          远程图片站点 ◀──── 受限出站下载器 ─────────────┤ 去重 → 原子公开/更新       │
                                                        └────────────┬────────────┘
                                                                     │ 事务 + 媒体引用
┌──────────────────┐          HTTPS                   ┌──────────────▼────────────┐
│ 公开读者浏览器    │ ◀──────────────────────────────▶ │ Web 应用 + SQLite + 媒体  │
│ 时间树 / 详情页   │                                  │ 公开页面 / 后台 / 审计     │
└──────────────────┘                                  └──────────────▲────────────┘
                                                                     │ 独立管理员会话
                                                        ┌────────────┴────────────┐
                                                        │ 站点所有者管理浏览器     │
                                                        └─────────────────────────┘
```

文章公开后，同版本的净化 DOM 进入正文提取器，再由持久 TTS Worker 调用后台当前启用的供应商；音频生成失败不回滚已公开文章。部署时数据库、图片和音频位于显式持久化目录；容器镜像中不包含内容数据或任何生产秘密。

## 4. 信息架构与路由

所有公开路径都以大小写固定的 `/Daily` 为基础路径；应用、反向代理、静态资源与 Cookie 共同遵守该前缀。

| 路由 | 用途 | 渲染策略 |
|---|---|---|
| `/Daily/` | 时间树主页、栏目筛选、日期定位 | 服务端首屏 + 客户端增强 |
| `/Daily/articles/[slug]` | 安全文章详情和朗读入口 | 服务端正文 + 客户端播放器 |
| `/Daily/api/v1/articles` | 创建单篇文章 | POST，共享 Bearer 密码 |
| `/Daily/api/v1/articles/[externalId]` | 覆盖更新逻辑文章 | PUT，共享 Bearer 密码；同时提交 `uploaderId` |
| `/Daily/api/v1/timeline` | 游标获取日期分组和文章摘要 | GET，公开只读 |
| `/Daily/api/v1/categories` | 获取已启用栏目 | GET，公开只读 |
| `/Daily/api/v1/articles/[id]/audio` | 当前公开版本音频状态、时长和流地址 | GET，公开只读 |
| `/Daily/api/v1/articles/[id]/audio/stream` | 当前公开版本 MP3 Range 流 | GET，公开只读；就绪前返回 404 |
| `/Daily/media/images/[...path]` | 已验证并转存的图片 | GET，公开只读、不可变缓存 |
| `/Daily/admin/login` | 所有者登录 | 未登录可访问；限流 |
| `/Daily/admin` | 后台概览 | 管理员会话 |
| `/Daily/admin/articles` | 浏览、撤下、上传更新和语音任务 | 管理员会话 |
| `/Daily/admin/categories` | 栏目新增、编辑、排序、启停 | 管理员会话 |
| `/Daily/admin/settings` | 站点、共享密码和 TTS 供应商设置 | 管理员会话 |
| `/Daily/admin/audits` | 上传、图片、语音和管理操作审计 | 管理员会话、只读 |
| `/Daily/admin/api/*` | 管理后台写操作与查询 | 管理员会话 + CSRF 防护 |
| `/Daily/api/health/live` | 进程存活 | GET，不访问秘密 |
| `/Daily/api/health/ready` | 数据库、媒体目录和迁移可用 | GET，不把 TTS 厂商故障视为整站故障 |

`/Daily` 永久重定向到 `/Daily/`。公开主页、文章详情、栏目、图片和当前版本音频无需登录。管理路由与管理 API 默认拒绝匿名访问；共享上传密码只用于文章摄取，不能建立管理员会话。

## 5. 首页体验设计

### 5.1 首屏结构

1. 顶部窄栏：站点名称、栏目筛选按钮、日期定位入口。
2. 当前日期标题：清晰显示年月日和当天文章数量。
3. 时间树主体：首屏直接出现主干、当前日期节点、栏目分枝和至少一张文章卡片。
4. 顶部不放大幅营销 Hero，不让读者先滚动才能看到内容。

### 5.2 时间树组件层级

```text
TimelinePage
├─ TimelineToolbar
│  ├─ CategoryFilter
│  └─ DateJump
├─ TimelineTree
│  ├─ ScrollProgressTrunk
│  └─ DayGroup[]
│     ├─ DateNode
│     └─ CategoryBranch[]
│        ├─ CategoryLabel
│        └─ ArticleLeaf[]
└─ TimelineLoadMore / EndState
```

### 5.3 桌面布局

- 主干保持在中线附近；日期节点压在主干上并作为该组的二级标题。
- 栏目分枝根据稳定排序在左右两侧交替，但同一栏目在相邻日期尽量保持方向一致，减少视觉跳跃。
- 每个分枝先显示栏目名和数量，再排列文章叶片。
- 文章叶片显示标题、摘要、时间、标签和上传者；整卡可点击，内部链接仍保持独立键盘行为。
- 当前视口所处日期以轻微光晕强调；树干已浏览部分与未浏览部分有明暗差异。

### 5.4 移动布局

- 主干移至距左侧约一个触控间距的位置。
- 所有日期节点、栏目分枝和叶片在主干右侧纵向排列。
- 筛选栏可横向滚动或折叠，但保留清晰可点击面积。
- 卡片内容不依赖悬停，摘要可限制行数但标题与栏目完整可见。

### 5.5 动效

- 日期组首次进入视口时，分枝从主干向外生长，叶片以短距离位移和透明度出现。
- 滚动只更新一个 CSS 进度变量，避免为每张卡片持续计算布局。
- 交互时间短且可中断；不使用自动播放的强闪烁、无限漂浮或影响阅读的视差。
- `prefers-reduced-motion: reduce` 下禁用生长位移和光效动画，只保留即时状态变化。

### 5.6 筛选与 URL 状态

建议使用查询参数表示可分享状态，例如：

```text
/Daily/?category=technology,medical&date=2026-09-07
```

筛选变化后重新获取日期组；返回文章列表时恢复筛选和近似滚动位置。栏目为空时显示“该范围暂无文章”，并提供清除筛选操作。

## 6. 文章详情设计

- 页首展示返回时间树、栏目、标题、摘要、发布时间、上传者和标签。
- 正文宽度以中文长文阅读为准，代码块、表格、引用、图片具有统一响应式样式。
- 上传 HTML 只进入正文容器，不能写入页面 `<head>`、站点导航或全局样式。
- 外部链接明确标识并使用安全跳转属性。
- 若净化删除了关键内容，上传阶段直接进入隔离或返回错误，避免读者看到悄然损坏的文章。
- 标题元数据区域提供“朗读”按钮；按钮根据当前版本显示“生成中”“朗读”或“暂不可用”，不会由匿名点击触发付费生成。

## 7. 管理后台设计

### 7.1 首版页面

| 页面 | 核心能力 |
|---|---|
| 登录 | 使用独立管理员密码登录；显示失败反馈但不透露账户或密码细节 |
| 概览 | 文章总量、今日上传、栏目分布、失败上传、图片异常和 TTS 任务状态 |
| 文章管理 | 按标题、栏目、状态、生成日期、自报上传者筛选；浏览当前及上一版本；撤下；上传完整 HTML 更新；查看或重试 TTS |
| 栏目管理 | 新增、改名、设置颜色、排序、启用和停用；已有引用时禁止破坏性删除 |
| 设置 | 站点名称、固定时区、共享上传密码轮换，以及 TTS 适配器、Base URL、API Key、模型和音色；秘密只允许重新设置 |
| 审计 | 查看上传、覆盖更新、图片摄取、TTS 和管理员操作；敏感 URL 与凭据始终脱敏 |

后台不提供 HTML 正文或元数据的直接编辑器。管理员更新文章时上传完整 HTML 文件并提交必要元数据，复用智能体上传的同一套解析、图片转存、净化、正文提取与版本切换管线。

### 7.2 管理认证与会话

- 管理员密码与共享上传密码分别使用带盐的慢散列保存；两者不得相同，也不得写入 Git、客户端代码或日志。
- 登录成功后签发服务端会话，Cookie 使用 `Secure`、`HttpOnly`、`SameSite=Lax`、host-only 和 `Path=/Daily/admin`，避免发送给公开页面或同域其他应用。
- 登录接口按 IP 限流并记录失败审计；会话具有空闲超时和绝对有效期，退出后立即失效。
- 所有管理写操作校验 CSRF 令牌和来源；高风险操作使用确认对话框。
- 匿名访问非公开文章返回 404，不通过响应差异泄露其存在。

### 7.3 状态不变量

- 普通新文章和当前公开文章的新版本在全部校验通过后自动公开。
- 管理员撤下的文章保持 `archived`；智能体覆盖更新可生成新版本，但不能解除撤下状态。
- 撤下、管理员文件更新、密码轮换、栏目启停、TTS 配置和任务重试都写入不可变管理审计。
- 共享上传密码只证明请求持有公共上传凭据；后台把 `uploaderId` 明确标为“声明的上传者”。

## 8. 上传 API 设计

### 8.1 请求示例

```http
POST /Daily/api/v1/articles HTTP/1.1
Authorization: Bearer <所有智能体共用的上传密码>
Content-Type: application/json; charset=utf-8
Idempotency-Key: tech-agent-2026-09-07-001

{
  "schemaVersion": "1",
  "uploaderId": "tech-agent",
  "externalId": "tech-agent-2026-09-07-001",
  "title": "今日科技简报",
  "summary": "当天值得关注的技术进展。",
  "category": "technology",
  "generatedAt": "2026-09-07T08:00:00+08:00",
  "tags": ["AI", "芯片"],
  "language": "zh-CN",
  "html": "<article><h2>...</h2><img src=\"https://example.org/chart.png\" alt=\"图表\"><p>...</p></article>"
}
```

共享密码只出现在请求头中。因为所有智能体使用同一个密码，`uploaderId` 必须由客户端提交且只能视为“声明身份”；服务端校验它存在且已启用，但不能据此证明真实调用者。

覆盖更新使用 `PUT /Daily/api/v1/articles/{externalId}` 并提交完整请求体。服务端按 `uploaderId + externalId` 找到逻辑文章；成功返回 200，保持内部 ID 和永久链接不变并递增版本。相同更新请求仍必须携带新的幂等键。

### 8.2 成功响应

```json
{
  "requestId": "req_...",
  "article": {
    "id": "art_...",
    "slug": "2026-09-07-technology-daily-brief",
    "url": "/Daily/articles/2026-09-07-technology-daily-brief",
    "contentDate": "2026-09-07",
    "category": "technology",
    "contentHash": "sha256:...",
    "version": 1,
    "publishedAt": "2026-09-07T08:00:03+08:00",
    "status": "published",
    "audioStatus": "queued"
  }
}
```

### 8.3 处理管线

```text
请求 ID
  → HTTPS / 方法 / Content-Type 检查
  → 按 IP 与共享凭据的速率限制
  → 共享 Bearer 密码散列校验
  → 请求体大小限制与 JSON 解析
  → schema、字段长度、栏目、URL、时间校验
  → HTML 解析、基础净化并提取受支持的 img[src]
  → 逐张图片做 URL/DNS/IP 校验、受限下载、解码和重新编码
  → 内容寻址保存图片并把 HTML URL 改写为本站地址
  → 最终 HTML 允许列表净化
  → 规范化 + SHA-256 内容摘要
  → 幂等键和创建/更新目标检查
  → 单事务写入文章版本、标签、媒体引用和审计结果
  → 继承管理员撤下状态，否则原子设为公开
  → 缓存失效
  → 从净化 DOM 提取可朗读正文并提交持久 TTS 任务
  → 立即返回结构化响应，不等待语音供应商
```

验证失败不创建公开文章；覆盖失败不改变旧公开版本。媒体文件先写临时区，数据库事务成功后才建立正式引用；孤儿文件由延迟清理任务回收。MVP 默认不保存原始 HTML，只保存原文摘要、净化结果和处理审计。

## 9. HTML 安全模型

### 9.1 已确认的允许能力（方案 A）

- 结构：标题、段落、列表、引用、分隔线、表格。
- 行内：强调、代码、上/下标、删除线。
- 媒体：首版只支持 `<img src="绝对 HTTPS URL">`，发布时转存为本站图片；拒绝 `data:`、`file:` 和任意嵌入。
- 链接：仅 `https:` 和必要的站内相对链接；统一补充安全属性。
- 代码块：只作为文本渲染，语法高亮由站点自身完成。

### 9.2 默认禁止

- `script`、事件处理属性、JavaScript URL。
- `style` 标签与内联 `style` 属性。
- `iframe`、`object`、`embed`、`portal`。
- `form`、输入控件、自动提交、刷新和重定向元信息。
- 上传内容自带的 `<html>`、`<head>`、`base`、全局 CSS 和站点导航。
- `srcset`、`picture/source`、CSS `url()`、视频封面及其他未纳入首版转存管线的远程资源。
- 客户端提供的路径、文件名和响应头。

### 9.3 纵深防御

- 先解析 DOM 再净化，不使用正则表达式过滤 HTML。
- 净化发生在服务端；数据库只保存可服务版本和规则版本号。
- 详情页仍设置严格 Content Security Policy、安全响应头和受控正文容器；`img-src` 与 `media-src` 只允许本站。
- 净化器使用恶意样本回归测试；规则升级时可重新处理历史文章。
- 最终详情页使用 `img-src 'self'`，防止遗漏的外部图片热链和追踪请求。

方案 A 已确认：上传 CSS、脚本和页面外壳一律不进入公开结果，不再建设保留原始视觉样式的沙箱分支。

### 9.4 远程图片安全转存

#### URL 与网络边界

- 首版仅接受绝对 `https` URL，不接受 URL 用户信息、IP 字面量、非标准端口或向 HTTP 的降级重定向。
- 每次连接和每一次重定向都重新解析 DNS；拒绝环回、私网、链路本地、CGNAT、组播、保留地址、云元数据地址以及包含任一非公网结果的域名。
- 下载器固定使用本次校验通过的 IP 建连，并核对实际 peer IP，避免 DNS 重绑定；最多跟随 3 次经重新校验的重定向。
- 下载请求不携带 Cookie、上传密码、管理员会话、Referer 或系统代理凭据。对外公开前，个人电脑防火墙还应在网络层阻止下载器访问本机和局域网。

#### 文件验证默认上限

- 每篇最多 20 个唯一远程图片 URL；单图最多 10 MiB，单篇累计最多 40 MiB。
- 单图连接超时 3 秒、总耗时 15 秒；每篇并发 2、全局并发 4，适配个人电脑运行。
- 不信任扩展名或响应头；必须按魔数和完整解码结果识别内容。
- 首版只接受 JPEG、PNG 和静态 WebP；拒绝 SVG、动画图片、超长边 8192 像素或总像素超过 25 MP 的图片。
- 图片在受限环境完整解码并重新编码，移除 EXIF、GPS、XMP、注释和其他非必要元数据；公开响应设置 `nosniff`。

#### 存储与失败语义

- 对重新编码后的安全字节计算 SHA-256，以内容摘要作为不可变文件名和去重键，例如 `/Daily/media/images/sha256/ab/<digest>.webp`。
- 文章版本通过关联表引用媒体；更新成功后原子切换引用，未被引用的图片延迟 24–72 小时回收，不能删除仍被其他文章使用的文件。
- 任一图片下载、校验、解码或落盘失败，整次创建/更新返回稳定错误且不公开；禁止回退为远程热链。
- 审计记录脱敏来源主机、重定向、DNS/IP、实际类型、尺寸、摘要、耗时和失败码；URL 查询参数不进入持久日志。

## 10. 认证与密钥设计

### 10.1 已确认方案

- 所有智能体共用一个由站点所有者设定的高熵上传密码，通过 `Authorization: Bearer ...` 发送。
- 服务端只保存带盐的慢散列，不保存或回显明文；管理后台仅支持设置新密码。
- 后台管理员使用另一套独立密码和会话。共享上传密码即使泄露，也不能访问管理页面或管理 API。
- `uploaderId` 来自请求并与后台启用列表比对，但属于自报信息。任何持有共享密码的调用者理论上都能冒充另一个 ID 或覆盖其文章，系统不声称完成了智能体级身份认证。
- 轮换共享密码会让所有旧客户端同时失效；后台在确认后执行，并记录管理审计。

### 10.2 额外控制

- 认证前后均按 IP、共享凭据版本和全局配额限制速率，失败次数采用短暂退避。
- 不使用 Cookie 保存上传凭据，因此上传 API 不依赖浏览器会话。
- 日志对 `Authorization`、请求正文和敏感查询做删减。
- 后台维护可用的 `uploaderId` 显示名；禁用某个 ID 只能阻止该声明值，不能阻止持有共享密码者改报其他 ID。
- 默认密码轮换立即使旧密码失效；如未来需要短暂重叠窗口，应显式记录起止时间。

### 10.3 讯飞凭据处理

- APPID、APIKey、APISecret 不写入 Git、示例配置、日志、截图型测试夹具或客户端代码；只有 TTS Worker 和管理员“测试配置”服务可短时解密。
- 用户通过截图提供过的凭据视为开发期已暴露凭据，不在文档中转录，也不直接用于生产。首次真实接入前应在讯飞控制台轮换，并仅将新值输入管理后台。
- 主加密密钥缺失或解密失败时 fail closed：文章仍可发布，TTS 状态显示不可用，不回退到明文配置。
- 若启用讯飞 IP 白名单，应填写本地 Linux 主机请求讯飞时的公网出口 IP，而不是 FRP 公网服务器地址；家庭公网 IP 变化时需更新白名单或使用固定出口。

## 11. 数据模型

### 11.1 实体关系

```text
DeclaredUploader 1 ─── * Article 1 ─── * ArticleVersion * ─── 1 Category
                            │                    │
                            │                    *
                            │                    │
                            │                    * MediaBlob
                            │
                            └────────────── * UploadAudit

AdminAccount 1 ─── * AdminSession
AdminAccount 1 ─── * AdminAudit
```

### 11.2 核心表

#### `categories`

`id`, `slug`（唯一）, `name`, `color`, `sort_order`, `enabled`, `created_at`, `updated_at`

#### `uploaders`

`id`, `display_name`, `enabled`, `created_at`, `updated_at`

该表是允许使用的“声明上传者”目录，不含独立凭据。因所有智能体共用密码，它不能证明真实调用者身份。

#### `articles`

`id`, `external_id`, `slug`（唯一且稳定）, `uploader_id`, `current_version_id`, `admin_status`, `created_at`, `updated_at`

唯一约束：`(uploader_id, external_id)`。`admin_status` 至少包含 `active`、`archived`；智能体更新不能把 `archived` 改回 `active`。

#### `article_versions`

`id`, `article_id`, `version`, `title`, `summary`, `category_id`, `generated_at`, `content_date`, `received_at`, `published_at`, `language`, `source_url`, `sanitized_html`, `raw_content_hash`, `sanitized_content_hash`, `sanitizer_version`, `created_at`

唯一约束：`(article_id, version)`。当前版本日期索引：`(content_date DESC, category_id, generated_at DESC, article_id DESC)`。每篇只保留当前版本和最近 1 份历史版本；更早版本删除正文与媒体引用，但保留最小更新审计。

#### `tags` 与 `article_version_tags`

标签规范化去重，多对多关联；显示值和用于比较的规范值分开保存。

#### `media_blobs` 与 `article_version_media`

`media_blobs` 以最终安全字节的 SHA-256 唯一，记录相对路径、MIME、字节数、宽高、处理状态和创建时间。关联表记录文章版本、图片摘要、原始位置和正文引用顺序。未引用媒体延迟清理。

#### `idempotency_records`

`uploader_id`, `idempotency_key`, `request_hash`, `article_id`, `response_code`, `created_at`, `expires_at`

#### `upload_audits`

`request_id`, `uploader_id_claim`, `article_id`, `version`, `credential_revision`, `result`, `error_code`, `content_length`, `ip_digest`, `created_at`

审计表不保存明文密码，也不默认保存完整 HTML、完整远程图片 URL 或完整请求正文。

#### `security_settings`、`admin_accounts`、`admin_sessions` 与 `admin_audits`

共享上传密码只保存散列和轮换版本。管理员账户保存独立密码散列；会话保存可撤销的服务端记录；管理审计记录操作者、动作、目标、前后状态摘要和时间，不记录秘密。

#### `speech_documents`

每个文章版本至多一条：`id`, `article_version_id`, `extractor_version`, `language`, `normalized_text`, `segments_json`, `text_hash`, `character_count`, `created_at`。只从净化后的 DOM 生成，不保存供应商返回文本。

#### `tts_provider_configs` 与 `encrypted_secrets`

供应商配置保存 `adapter_type`, `endpoint_id`, `voice`, `public_config_json`, `profile_revision`, `credential_revision`, `is_active` 和测试状态。讯飞凭据包包含 APPID、APIKey、APISecret，使用独立主密钥经 AEAD 加密后关联保存；读取 API 永不返回原值或密文。

#### `tts_jobs` 与 `tts_chunks`

任务记录文章版本、供应商配置快照、声音配置摘要、状态、重试、租约和安全错误码；分段记录顺序、文本摘要、供应商请求 ID、临时文件、时长和结果摘要。SQLite 租约保证进程重启后可恢复。

#### `audio_assets`

记录 `speech_document_id`, `tts_job_id`, `voice_profile_hash`, `storage_key`, `mime_type`, `duration_ms`, `byte_size`, `sha256`, `created_at`。公共读取必须先确认所属文章仍公开且该音频对应当前版本。

## 12. 时间与分类规则

- 站点配置 `SITE_TIMEZONE` 固定为用户确认的 `Asia/Shanghai`，不能依赖服务器操作系统时区。
- `generatedAt` 表示智能体声明的文章生成时间，必须带 `Z` 或明确偏移；缺少偏移返回 422。
- `receivedAt` 表示服务器收到请求的时间，`publishedAt` 表示该版本通过全部处理并公开的服务器时间，两者均不可由客户端覆盖。
- `contentDate` 由服务端将 `generatedAt` 转换到 `SITE_TIMEZONE` 后得到。
- 同一天按 `categories.sort_order` 展示栏目；同栏目按 `generated_at DESC, article_id DESC` 稳定排序。
- 更新改变 `generatedAt` 或栏目时，文章会移动到新的日期节点或分枝，永久链接保持不变。
- 未配置或已禁用栏目拒绝上传，不自动创建新栏目，防止拼写错误制造垃圾分类。
- 标签可由上传者提供，但做长度、数量和规范化限制；标签不决定主栏目。

## 13. 查询与性能

- 首页查询只返回卡片所需字段，不返回 `sanitized_html`。
- 使用基于 `(content_date, generated_at, article_id)` 的游标分页，不使用会随新增内容漂移的深 offset。
- 每次加载完整日期组；默认批量大小在实现时用真实样本调优。
- 栏目筛选尽量由服务端完成，并在查询中使用复合索引。
- 热门详情可使用短期 HTTP 缓存；新上传成功后使相关日期组缓存失效。
- SQLite 适用于单应用实例。需要多实例并发写入时迁移到 PostgreSQL，不共享网络文件系统上的 SQLite 文件。

## 14. 建议项目结构

```text
.
├─ app/
│  ├─ page.tsx
│  ├─ articles/[slug]/page.tsx
│  ├─ admin/
│  └─ api/v1/
├─ components/
│  ├─ timeline/
│  ├─ article/
│  └─ admin/
├─ lib/
│  ├─ auth/
│  ├─ db/
│  ├─ ingest/
│  ├─ media/
│  ├─ sanitize/
│  ├─ speech/
│  ├─ tts/
│  └─ validation/
├─ workers/
│  └─ tts-worker.ts
├─ migrations/
├─ tests/
├─ data/                 # 运行时挂载：SQLite、图片与音频
├─ docs/
├─ .env.example
├─ Dockerfile
├─ compose.yaml
└─ package.json
```

最终目录会遵循所选框架的约定；上图表达职责边界，不是提前承诺每个文件名。

## 15. TTS 朗读子系统

本文统一使用行业术语 **TTS（Text-to-Speech，文字转语音）**；它对应需求描述中的“TSS”。

### 15.1 异步链路

```text
方案 A 净化后的 HTML
  → 正文提取与规范化
  → 按供应商字符/字节限制稳定分段
  → SQLite 持久任务
  → Provider Adapter 分段合成
  → FFmpeg 统一编码并顺序拼接
  → 内容摘要命名的 MP3
  → 当前文章版本公开音频接口
```

文章在正文与图片处理成功后立即公开，TTS 不参与发布事务。任务状态为 `QUEUED → SYNTHESIZING → ASSEMBLING → READY`，可转入 `RETRY_WAIT`、`FAILED`、`CANCELED` 或 `SUPERSEDED`。页面不展示虚假百分比或预计时间。

### 15.2 正文提取

- 只读取净化后的 DOM，优先 `<article>`/`<main>`，否则按文本密度选择主内容；绝不把原始 HTML 直接交给供应商。
- 朗读标题、段落、标题层级、列表、引用、图注和必要表格文本；默认忽略代码块、URL、导航和隐藏节点。
- 解码实体、规范化 Unicode 和空白，并用中文标点保留自然停顿。若适配器使用 SSML，只能由本站从纯文本生成并完整转义。
- 长文优先按段落、句号/问号/感叹号、分号、逗号和 Unicode 字素边界逐级切分，同时满足供应商字符数和 UTF-8 字节数上限。
- `text_hash` 包含提取器版本与规范化文本，提取结果与 `articleVersionId` 一一绑定并可在后台只读预览。

### 15.3 供应商适配层

业务层只依赖统一能力：配置校验、能力查询、连接测试、单段合成和错误分类。首版确定实现稳定标识为 `xfyun-online-ws-v2` 的讯飞专用适配器，不复用 OpenAI-compatible 适配器。

不同国产厂商采用不同签名、异步任务或专有请求格式时，新增对应 `adapterType`，不修改文章、任务和播放器代码。只有协议兼容的厂商才能单纯替换 URL/API Key；后台不允许编写任意请求模板或任意请求头。

### 15.4 科大讯飞在线语音合成适配器

协议依据：[科大讯飞在线语音合成 WebAPI 官方文档](https://www.xfyun.cn/doc/tts/online_tts/API.html)。

#### 固定端点与鉴权

- 只连接 `wss://tts-api.xfyun.cn/v2/tts`，握手请求行为 `GET /v2/tts HTTP/1.1`。该适配器不开放任意 Base URL、请求头或模板，避免签名不一致、SSRF 和凭据外送。
- 首版使用 APPID、APIKey、APISecret 的鉴权方式。每次握手以 GMT/RFC1123 当前时间生成 `host`、`date` 和 `authorization` 查询参数。
- 待签名串严格为 `host: tts-api.xfyun.cn\ndate: {date}\nGET /v2/tts HTTP/1.1`；以 APISecret 做 HMAC-SHA256 后 Base64，再将包含 APIKey、算法、headers 与 signature 的 authorization 原文整体 Base64。
- APPID 不参与 HMAC，放在请求 `common.app_id`。讯飞允许的时钟偏差最大 300 秒，因此 Linux 主机必须启用可靠时间同步并监测偏差。
- 带 `authorization` 的完整 WebSocket URL 视同秘密，不得进入代理访问日志、应用异常、追踪、审计或监控标签。

#### 请求、分段与音频

- 每个文本段建立一个独立 WebSocket 会话，文本按 UTF-8 编码后 Base64；输入只能一次发送，`data.status` 固定为 `2`。
- 官方限制为 Base64 前原文严格小于 8000 字节。工程上采用 7600 字节安全上限，按段落和中文标点切分，绝不按 JavaScript code unit 或 Base64 后长度切分。
- 首版固定 `aue=raw`、`auf=audio/L16;rate=16000`、`tte=UTF8`、`bgs=0`、`reg=0`、`rdn=0`，获取 16 kHz PCM，再由 FFmpeg 统一编码并拼接为 MP3，避免跨会话拼接 MP3 头的问题。
- `vcn` 为必填发音人，首版默认 `x4_xiaoyan`；`speed`、`volume`、`pitch` 均允许 0–100，默认 50。默认值仍必须在对应 APPID 下已开通并通过配置测试。
- 首版使用 JSON/Base64 响应，不启用 `output_proto=binary`。依次严格解码 `data.audio`；`code=0,data=null` 可忽略，只有收到非空音频且 `data.status=2` 才算该段成功。
- WebSocket 库必须完成消息分片重组；断线或超时产生的残缺 PCM 全部丢弃，整段重新建立会话，不做片段续传。

#### 错误分类

- 握手 401，以及 APPID、Base64、文本长度、JSON、参数和授权类错误不自动重试；403 归为时钟或 IP 白名单运维阻塞。
- `11202`/`11203` 按 QPS/并发限流退避并降低并发；`11201` 总量或日额度耗尽时暂停等待人工处理。
- 网络、TLS、连接重置、5xx 与供应商临时错误整段最多自动尝试 3 次，每次丢弃部分音频。未知非零错误默认人工重试，避免重复计费。
- 诊断保存安全分类、供应商 code、阶段、是否可重试和 `sid`；讯飞部分错误码存在多重语义，因此同时保留脱敏 message 摘要，但不保存原始报文、正文或签名 URL。

### 15.5 后台语音设置

- 启用/停用自动生成；保存多个供应商配置，并选择唯一活动配置。
- 讯飞首版配置：显示名、启用/活动状态、APPID、APIKey、APISecret、发音人 `vcn`（默认 `x4_xiaoyan`）、语速、音量和音高。端点、编码、采样率、协议模式、分段上限、超时与重试属于系统固定或部署配置。
- 使用固定短句测试连接，并提示测试可能产生供应商费用；只显示脱敏结果和测试时间。
- 三项讯飞凭据使用 AES-256-GCM 等 AEAD 分字段加密，AAD 绑定配置 ID、字段用途和凭据修订；接口只返回 `hasAppId/hasApiKey/hasApiSecret` 与更新时间，绝不返回掩码原文或密文。
- 配置测试不是 ping：管理员明确点击后用固定短句完成一次真实合成、验证结束帧与非空 PCM，然后丢弃测试音频；保存、页面加载和健康检查不会自动计费调用。
- Base URL 默认禁止环回、私网、链路本地与云元数据地址。若以后接入本机 TTS，使用精确白名单而不是关闭 SSRF 防护。

### 15.6 Worker、重试与成本控制

- 单机首版使用 SQLite 任务表和租约，不引入 Redis；TTS Worker 可与 Web 进程分开启动，默认单并发。
- 网络错误、超时、408、429 和 5xx 使用指数退避并遵循 `Retry-After`；认证、模型或参数错误直接失败。
- 分段成功结果可复用，重试只处理失败或缺失分段；同一 `text_hash + voice_profile_hash` 去重，避免重复计费。
- FFmpeg 把各段统一为固定采样率、声道和 MP3 编码后拼接，临时文件完成校验后原子重命名。
- 匿名读者只能查询和播放结果，不能创建、重试或重新生成任务；管理员可重试、取消或对单篇重新生成。

### 15.7 覆盖更新与保留

- 新版本成为当前版本时，旧音频立即停止从公共接口提供，旧任务标为 `SUPERSEDED`；Worker 落盘前再次确认目标仍是当前版本。
- 若新旧 `text_hash` 和声音配置摘要相同，可复用已生成音频；API Key 轮换本身不使缓存失效。
- 每篇保留当前版本和上一版本及其图片、提取文本和音频；第三个版本成功后异步清理更老且无引用的文件。
- 更改默认供应商只影响之后的新任务；既有 MP3 保持可用，管理员可主动重新生成。
- 管理员撤下文章后，正文与音频公共接口都返回 404；智能体更新不能解除撤下状态。

### 15.8 朗读按钮与播放胶囊

- 每篇文章始终保留朗读入口：`QUEUED/SYNTHESIZING/ASSEMBLING` 显示“朗读生成中”，`READY` 显示“朗读”，`FAILED` 或未配置供应商显示“朗读暂不可用”。公开端不显示供应商原始错误。
- READY 后由用户明确点击才播放，不自动播放。播放器是固定在底部的非模态 `region`，不锁焦点，并给正文增加等高底部留白。
- 首版控件：文章标题、播放/暂停、后退/前进 15 秒、进度条、当前/总时长、0.75/1/1.25/1.5/2 倍速和关闭。
- 播放器位于 `/Daily` 顶层布局，站内切换继续播放；节流保存位置到 `sessionStorage`，硬刷新后恢复为暂停状态。倍速偏好可存 `localStorage`。
- 音频接口校验当前公开版本并支持 `Range`、`ETag` 和 `audio/mpeg`；媒体 URL 使用内容摘要且不覆盖。
- 控件使用原生按钮、选择框和范围控件，触控目标至少 44×44px；支持键盘、读屏、200% 缩放、移动安全区和 `prefers-reduced-motion`。

## 16. 运行与部署设计

### 16.1 目标拓扑

```text
读者 / 上传智能体
  → https://codis.fun:443（公网 Nginx/Caddy，TLS 与 /Daily 路由）
  → 127.0.0.1:18080（仅公网服务器本机可达的 FRP 代理端口）
  → 认证且加密的 FRP 隧道
  → 本地 Linux frpc
  → 127.0.0.1:3000（npm）或 Compose 私有网络 app:3000
```

公网只开放 80/443 和受防火墙保护的 FRP 控制端口。FRP 映射端口、仪表盘、应用端口、SQLite 和健康检查不得直接暴露公网。公网反向代理终止 TLS 并保留 `/Daily` 前缀，FRP 只承担 TCP 隧道。

反向代理核心约定：

```nginx
location = /Daily { return 308 /Daily/; }

location ^~ /Daily/ {
    proxy_pass http://127.0.0.1:18080;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Port  443;
    proxy_set_header X-Forwarded-Prefix /Daily;
    proxy_set_header X-Forwarded-For   $remote_addr;
    proxy_set_header X-Request-ID      $request_id;
}
```

`proxy_pass` 末尾不加 `/`，从而把 `/Daily/...` 原样交给应用。公网代理必须覆盖客户端伪造的转发头；应用只信任明确配置的代理来源，并只用固定 `PUBLIC_BASE_URL` 生成规范链接。

FRP 强制传输 TLS 和强认证，映射端口绑定公网服务器回环地址。`FRP_TOKEN`、上传密码、管理员密码、TTS 主加密密钥和厂商 API Key 是五类互不复用的秘密。

参考：[FRP TCP](https://gofrp.org/en/docs/features/tcp-udp/)、[FRP TLS](https://gofrp.org/en/docs/features/common/network/network-tls/)、[Nginx proxy_pass](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass)。

### 16.2 `/Daily` 基础路径

- 应用固定 `APP_BASE_PATH=/Daily` 和 `PUBLIC_BASE_URL=https://codis.fun/Daily`；框架 Router、构建资源前缀和服务端 URL 生成共用一处配置。
- 页面链接、JS/CSS、`fetch`、表单、图片、音频、登录跳转、错误页、canonical、sitemap 和健康检查都不得硬编码域名根路径。
- 上传 HTML 内以 `/xxx` 开头的链接必须按规则重写、转为安全站内链接或拒绝，不能意外跳出 `/Daily`。
- npm 与 Docker 必须使用相同构建期基础路径；任何文章深层链接直接刷新都应工作。
- 管理 Cookie 限定 `Path=/Daily/admin`；若以后改变后台 API 路径，必须重新验证 Cookie 作用域。

### 16.3 npm 路径

- `npm run dev`：本地开发；`npm run build`：生产构建；`npm run start`：Web 服务；`npm run worker:tts`：TTS Worker；`npm run db:migrate`：迁移；`npm run test`：测试。
- 生产 Web 服务只监听 `127.0.0.1:3000`，由 frpc 访问；Web、Worker 和 frpc 使用 systemd 开机启动、故障重启和日志轮转。
- Linux 主机安装并固定 Node 与 FFmpeg 版本；数据库、图片、音频、临时目录和备份使用固定权限目录。
- 物理机睡眠、关机或家庭网络中断会让 `/Daily` 暂时不可用；公网代理只为 `/Daily` 返回受控 503，不影响 `codis.fun` 其他路径。

### 16.4 Docker 路径

- 多阶段构建，只复制生产产物；最终容器使用非 root 用户并包含固定版本 FFmpeg。
- 应用容器可监听 `0.0.0.0:3000`，但宿主端口只能映射 `127.0.0.1:3000:3000`；若 frpc 同在 Compose，应用端口不发布，只通过私有网络访问。
- `/app/data` 持久卷包含 SQLite、图片和音频；SQLite 位于本机 ext4/xfs 等本地文件系统，不放网络文件系统。
- 密钥不写入镜像或 Compose 源文件；通过受限环境文件或 Docker Secret 注入。
- 健康检查使用带 `/Daily` 的路径；容器重启后 Web 与 TTS 任务继续工作。

### 16.5 健康、缓存与边缘行为

- `live` 只检查 Web 进程；`ready` 检查迁移、SQLite 和媒体目录可读写。TTS 厂商故障单独显示，不导致整站 readiness 失败。
- 哈希图片和 MP3 使用不可变 URL；MP3 支持 Range。文章页面和状态接口短缓存，撤下后立即失效。
- 图片和音频会经过家庭上行与 FRP；初期直接提供，流量增大后可在公网 Nginx 对哈希媒体增加磁盘缓存。
- 公网代理和应用层同时限制上传大小、认证失败速率和并发；错误密码请求不得触发图片下载或 TTS。

### 16.6 备份

- 对 SQLite 使用一致性备份方法，不在活跃写入时随意复制文件。
- 备份包含数据库、当前与上一文章版本、图片、音频和非秘密部署配置；不包含 FRP token、TTS 主密钥或明文密码。
- 恢复演练覆盖“新目录恢复 → 迁移 → 启动 Web/Worker → 匿名阅读 → 播放音频”。

## 17. 配置草案

| 配置 | 示例/说明 | 是否秘密 |
|---|---|:---:|
| `SITE_NAME` | 站点显示名 | 否 |
| `SITE_TIMEZONE` | 固定 `Asia/Shanghai` | 否 |
| `APP_BASE_PATH` | 固定 `/Daily` | 否 |
| `PUBLIC_BASE_URL` | 固定 `https://codis.fun/Daily` | 否 |
| `ALLOWED_HOSTS` | `codis.fun` | 否 |
| `TRUSTED_PROXY_CIDRS` | 仅本机或 Compose 私网代理来源 | 否 |
| `DATABASE_URL` | 指向持久化 SQLite 文件 | 视环境而定 |
| `MEDIA_ROOT` | 图片、音频与临时文件的持久目录 | 否 |
| `ADMIN_BOOTSTRAP_PASSWORD_HASH` | 首次建立管理员账户 | 是 |
| `TTS_MASTER_KEY` | 加密后台保存的厂商 API Key | 是 |
| `MAX_ARTICLE_BYTES` | 建议默认 2097152 | 否 |
| `UPLOAD_RATE_LIMIT` | 每共享凭据版本/IP 的窗口限制 | 否 |
| `TTS_WORKER_CONCURRENCY` | 个人电脑默认 1 | 否 |

栏目、声明上传者、共享密码散列和 TTS 供应商配置由后台保存在数据库；API Key 加密保存。FRP 配置属于部署层，不与应用设置混写。

## 18. 测试策略

### 18.1 单元测试

- 时间转站点日期和夏令时边界。
- 栏目与标签规范化。
- 凭据摘要和恒定时间比对。
- HTML 允许/拒绝规则、危险 URL、畸形 HTML。
- slug 冲突与稳定排序。
- 正文提取、中文分段、文本摘要和声音配置摘要。
- `/Daily` URL 连接、资源路径和 Cookie Path 生成。
- 使用假凭据验证讯飞 RFC1123/HMAC 签名黄金样例、7600 字节分段、Base64 严格解码和错误分类；测试输出不得含假密钥原文或完整签名 URL。

### 18.2 集成测试

- 上传成功和所有定义错误码。
- 幂等键同内容重放、不同内容冲突。
- 事务失败不产生半记录。
- 新文章自动出现在正确日期/栏目查询结果中。
- 禁用上传者和禁用栏目立即阻止新内容。
- TTS 任务租约恢复、分段重试、缓存复用、旧任务 `SUPERSEDED` 和最终 MP3 拼接。
- TTS 配置加密、不回显、测试连接和供应商错误分类。
- 使用录制并脱敏的讯飞 JSON/TextMessage fixture 验证 `data=null`、多音频片段、`status=2`、消息分片、异常断线和残片清理；默认测试不访问付费 API。

### 18.3 端到端测试

- 智能体上传 → 首页出现叶片 → 打开文章详情。
- 栏目筛选、日期定位、刷新和返回恢复。
- 手机布局、键盘浏览、减少动态效果。
- npm 与 Docker 各完成一次冒烟链路。
- `/Daily`、文章深层链接、后台跳转、转存图片和 MP3 Range 在 FRP 代理路径下工作，域名其他路径不受影响。
- 文章发布后立即可读，TTS 状态随后变为 READY；供应商失败时正文仍可读且管理员可重试。
- 播放胶囊支持完整控件、移动安全区、站内持续播放和刷新后暂停恢复。
- 真实讯飞冒烟测试仅通过显式环境开关和管理员动作运行，使用固定短句并提示可能计费；CI、健康检查和普通构建不得调用。

## 19. 可观测性与运维

- 每个请求生成 `requestId`，API 响应与结构化日志均携带。
- 记录结果、耗时、声明上传者 ID、文章/版本 ID、错误码、图片与 TTS 统计，不记录密钥或完整正文。
- 监测上传失败率、认证失败率、数据库错误、净化删除比例、图片拒绝、TTS 队列深度/失败率和磁盘余量。
- 若单篇文章大量内容被净化，进入告警或隔离，而不是默默自动发布。
- TTS 后台只显示安全错误码和脱敏信息；公网 FRP、Web readiness 与厂商连通性分开监测。

## 20. 分阶段实施建议

### 阶段 1：安全摄取与后台骨架

完成数据模型、认证、管理登录、上传校验、图片转存、方案 A 净化、版本与审计。

### 阶段 2：TTS 闭环

完成正文提取、供应商适配器、后台配置、SQLite Worker、FFmpeg、MP3 与失败重试。

### 阶段 3：时间树、后台和播放器体验

完成首页时间树、筛选、文章详情、后台文章/栏目界面、播放胶囊、响应式与无障碍。

### 阶段 4：本地 Linux 与公网交付

完成 npm 与 Docker、systemd/Compose、`/Daily`、FRP、反向代理、TLS、健康检查、备份恢复和部署文档。

## 21. 审核入口

方案 A、单个历史版本、后台文章操作范围、`Asia/Shanghai`、`https://codis.fun/Daily/`、科大讯飞在线语音合成 WebAPI 和默认发音人 `x4_xiaoyan` 均已确认。

当前没有阻塞实现的产品决策。文档进入整体审核状态；用户确认审核通过后，再开始应用脚手架与实现。

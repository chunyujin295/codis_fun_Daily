# 远程智能体内容发布技术方案

| 项目 | 内容 |
| --- | --- |
| 文档状态 | Draft |
| 版本 | 1.0 |
| 日期 | 2026-09-09 |
| 适用项目 | Daily Knowledge Timeline |
| 部署环境 | Linux 物理机、Docker Compose、nginx/FRP |

## 1. 背景

Daily Knowledge Timeline 部署在一台本地 Linux 物理机上。该物理机只负责运行网站、持久化文章和媒体、执行异步语音任务，不负责运行文章生产智能体。

文章智能体可能运行在任意受信任机器或智能体平台上，包括 Windows、Linux、云主机和临时任务环境。智能体生成 HTML 后，需要通过公网安全地提交给网站；网站收到内容后应自动完成校验、净化、图片转存、版本入库、公开展示和语音任务创建。

本方案中的“自动更新”指内容数据更新，不指网站源代码自动部署。文章发布不依赖 Git，不触发应用构建，也不要求重启网站。

## 2. 目标

1. 任意受信任智能体能够通过 HTTPS 发布文章，不需要登录 Linux 主机。
2. 智能体不需要克隆网站仓库，也不需要访问 SQLite、Docker、SSH 或管理后台。
3. 每个智能体使用独立、可撤销、可限定栏目的上传令牌。
4. 同一逻辑请求可以安全重试，不产生重复文章版本。
5. 网站成功接收文章后立即展示，不进行代码部署或服务重启。
6. HTML、外部图片和元数据在服务端统一校验与处理。
7. 上传、失败、令牌使用和文章版本变化均可审计。
8. Linux 单机故障后可以从备份恢复数据库和媒体。

## 3. 非目标

本方案不包含以下能力：

- GitHub 或其他代码托管平台触发的自动部署；
- 智能体修改网站源码、环境变量或数据库；
- 向智能体开放 Linux SSH、Docker Socket 或管理后台权限；
- 在浏览器端保存上传令牌；
- 绕过 HTML 净化后直接托管智能体生成的完整网页；
- 多节点数据库复制或跨机房高可用。

网站代码升级继续采用受控人工流程，例如：

```bash
git pull --ff-only
docker compose up -d --build
curl --fail http://127.0.0.1:5010/Daily/api/health/ready
```

## 4. 总体架构

```text
┌──────────────────────────────────────┐
│ 任意受信任智能体机器                 │
│                                      │
│ 生成 HTML + metadata                 │
│ 读取本机 Secret                      │
│ 生成 Idempotency-Key                 │
└──────────────────┬───────────────────┘
                   │ HTTPS + Bearer Token
                   ▼
        https://codis.fun/Daily/api/v1/articles
                   │
                   ▼
┌──────────────────────────────────────┐
│ 公网 nginx / FRP / 本地 nginx        │
│ TLS 终止、转发、请求大小与超时控制   │
└──────────────────┬───────────────────┘
                   ▼
┌──────────────────────────────────────┐
│ Linux 物理机上的 Daily 应用          │
│                                      │
│ 认证与限流                           │
│ 元数据校验                           │
│ HTML 净化与图片转存                  │
│ SQLite 事务与文章版本                │
│ TTS 任务入队                         │
└───────────────┬──────────────────────┘
                │
                ▼
      页面立即读取最新已发布版本
```

系统采用推送模式：智能体完成内容后主动调用 API。Linux 服务器不轮询智能体、不扫描共享目录，也不从 Git 获取文章。

## 5. 当前实现评估

### 5.1 已具备能力

现有项目已经提供：

- `POST /Daily/api/v1/articles`：创建文章或提交新版本；
- `PUT /Daily/api/v1/articles/{externalId}`：显式更新文章；
- Bearer 共享密码认证；
- 按请求 IP 限流；
- `Idempotency-Key` 幂等记录；
- Zod 元数据校验；
- HTML 白名单净化；
- 远程 HTTPS 图片下载和本地存储；
- SQLite 事务；
- `uploaderId + externalId` 逻辑文章定位；
- 文章版本递增，并保留当前版和上一版；
- 发布后立即进入公开时间线；
- 可用 TTS 提供方存在时自动创建异步任务；
- 管理员撤下的文章不会被普通智能体提交重新公开。

### 5.2 当前缺口

1. 所有智能体共用一个上传密码，泄露后必须整体轮换。
2. `uploaderId` 由请求体声明，共享密码持有者可以冒充其他智能体。
3. `uploaders.enabled` 尚未成为上传认证条件，无法可靠停用单个上传者。
4. 缺少令牌级栏目权限、过期时间、最后使用时间和单独撤销能力。
5. 官方发布脚本位于项目仓库内，不适合没有仓库副本的任意机器。
6. 缺少机器可读的 OpenAPI 契约和独立发布客户端。
7. 失败告警、数据库在线备份和孤儿媒体清理尚未形成固定运维流程。

## 6. 内容发布接口

### 6.1 接口地址

创建或自动形成新版本：

```http
POST https://codis.fun/Daily/api/v1/articles
```

显式更新指定逻辑文章：

```http
PUT https://codis.fun/Daily/api/v1/articles/{externalId}
```

两种请求使用相同的认证、元数据结构和幂等规则。推荐普通智能体统一使用 `POST`；需要严格核对 URL 中 `externalId` 的集成使用 `PUT`。

### 6.2 请求头

```http
Authorization: Bearer dk_live_<token-id>.<secret>
Content-Type: application/json; charset=utf-8
Idempotency-Key: agent-<sha256-of-canonical-request>
```

要求：

- 正式环境仅接受 HTTPS；
-令牌不得放入 URL、查询参数、HTML、元数据或日志；
- `Idempotency-Key` 长度不超过 120 字符；
- 同一次逻辑提交的所有重试必须使用相同请求体和相同幂等键；
- 修改内容后必须生成新的幂等键。

### 6.3 请求体

```json
{
  "schemaVersion": "1",
  "uploaderId": "technology-agent",
  "externalId": "technology-2026-09-09",
  "title": "今日科技简报",
  "summary": "今天值得关注的技术进展。",
  "category": "technology",
  "generatedAt": "2026-09-09T09:00:00+08:00",
  "tags": ["AI", "芯片"],
  "language": "zh-CN",
  "sourceUrl": "https://example.com/source",
  "html": "<article><h2>标题</h2><p>正文</p></article>"
}
```

字段约束沿用现有 `articleInputSchema`：

| 字段 | 约束 |
| --- | --- |
| `schemaVersion` | 固定为 `1` |
| `uploaderId` | 1～80 字符，只允许字母、数字、点、下划线和连字符 |
| `externalId` | 1～100 字符，同一逻辑文章保持不变 |
| `title` | 1～120 字符 |
| `summary` | 最长 300 字符 |
| `category` | 必须是已启用且令牌有权发布的栏目 |
| `generatedAt` | ISO 8601，必须包含时区偏移 |
| `tags` | 最多 10 个，每个最长 30 字符 |
| `language` | 默认 `zh-CN` |
| `sourceUrl` | 可选，只允许 HTTPS URL |
| `html` | 非空，UTF-8 字节数不得超过服务端限制 |

每日文章的 `externalId` 建议采用 `<category>-YYYY-MM-DD`，例如 `technology-2026-09-09`。

### 6.4 成功响应

```json
{
  "requestId": "5e03c1a7-...",
  "article": {
    "id": "20f3efb4-...",
    "slug": "2026-09-09-technology-technology-2026-09-09",
    "url": "/Daily/articles/2026-09-09-technology-technology-2026-09-09",
    "version": 1,
    "contentDate": "2026-09-09",
    "category": "technology",
    "contentHash": "...",
    "status": "published",
    "audioStatus": "queued"
  },
  "replayed": false
}
```

语义：

- `201`：创建文章或新版本成功；
- `200`：显式更新成功，或者返回之前的幂等结果；
- `replayed: true`：该逻辑请求此前已经成功，未生成额外版本。

客户端应使用 `DAILY_BASE_URL` 补全响应中的相对 URL，并只在收到 `200/201` 后报告发布成功。

## 7. 智能体身份与令牌设计

### 7.1 数据模型

保留现有 `uploaders` 表，新增令牌和栏目授权表：

```sql
CREATE TABLE IF NOT EXISTS upload_tokens (
  id TEXT PRIMARY KEY,
  uploader_id TEXT NOT NULL REFERENCES uploaders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_token_categories (
  token_id TEXT NOT NULL REFERENCES upload_tokens(id) ON DELETE CASCADE,
  category_slug TEXT NOT NULL REFERENCES categories(slug),
  PRIMARY KEY(token_id, category_slug)
);

CREATE INDEX IF NOT EXISTS idx_upload_tokens_uploader
  ON upload_tokens(uploader_id, enabled);
```

### 7.2 令牌格式与存储

建议格式：

```text
dk_live_<token-id>.<256-bit-random-secret>
```

- `token-id` 用于数据库定位，不作为秘密；
- `secret` 使用安全随机数生成；
-数据库只存储完整令牌的 SHA-256 哈希，不存储明文；
-因为令牌具有至少 256 bit 随机熵，哈希用于查找和验证即可；
-令牌明文仅在创建时返回一次；
- `token_prefix` 只用于后台识别，例如 `dk_live_ab12…`。

### 7.3 认证结果

`verifyUploadRequest` 成功后返回可信主体：

```ts
type UploadPrincipal = {
  tokenId: string;
  uploaderId: string;
  allowedCategories: string[];
};
```

接口必须校验：

1. Token 存在、启用且未过期；
2. 绑定的 Uploader 存在且启用；
3. 请求体 `uploaderId` 与 Token 绑定值完全一致；
4. 请求体 `category` 在 Token 授权栏目中；
5. PUT 路径中的 `externalId` 与请求体一致。

不能继续把请求体中的 `uploaderId` 当作可信身份。

### 7.4 限流

在现有 IP 限流基础上增加 Token 维度：

```text
单 IP：30 次/分钟
单 Token：20 次/分钟
认证失败 IP：10 次/分钟
```

nginx 必须覆盖客户端传入的 `X-Real-IP`，应用只信任由受控反向代理写入的来源地址。

### 7.5 兼容迁移

引入配置：

```dotenv
ALLOW_LEGACY_UPLOAD_PASSWORD=true
```

迁移步骤：

1. 上线独立令牌认证，同时保留旧共享密码；
2. 为每个已有智能体创建独立令牌；
3. 确认审计日志中不再出现 Legacy 认证；
4. 设置 `ALLOW_LEGACY_UPLOAD_PASSWORD=false`；
5. 从后台删除旧共享密码哈希。

## 8. 服务端处理流程

```text
接收请求
  ↓
检查请求大小和限流
  ↓
验证 Bearer Token，得到 UploadPrincipal
  ↓
解析并校验 JSON
  ↓
校验 uploaderId、category 和 externalId 权限
  ↓
检查 Idempotency-Key
  ├─ 相同 Key + 相同内容 → 返回历史成功结果
  └─ 相同 Key + 不同内容 → 409
  ↓
净化 HTML、提取文本、暂存远程图片
  ↓
SQLite 事务：文章、版本、媒体引用、TTS 任务、审计、幂等记录
  ↓
提交事务并将暂存媒体转为正式媒体
  ↓
返回公开 URL、版本和语音状态
```

### 8.1 HTML 处理

继续沿用现有白名单净化策略：

-允许文章语义元素、标题、段落、列表、表格、链接和图片；
-移除脚本、内联样式、事件处理器、iframe、表单、SVG、音视频；
-外部图片仅允许绝对 HTTPS URL；
-阻止环回地址、私网地址、链路本地地址和云元数据地址，防止 SSRF；
-限制图片数量、单图大小、总大小、像素尺寸、重定向次数和下载超时；
-下载失败时整个候选版本失败，旧版本继续公开。

媒体文件应先写入 `data/tmp/uploads/<requestId>/`。数据库事务成功后再原子移动到正式目录；失败时删除暂存目录。另设周期性清理任务删除超时暂存文件和无数据库引用的媒体，避免孤儿文件积累。

### 8.2 文章版本

- `uploaderId + externalId` 唯一定位一篇逻辑文章；
-第一次成功提交创建版本 1；
-后续不同内容创建新版本；
-永久 slug 不变；
-默认保留当前版和上一版；
-管理员撤下状态优先，普通智能体更新不得恢复公开；
-文章事务失败时不得修改当前版本指针。

### 8.3 页面更新

文章数据存储在 SQLite 中，页面请求读取当前已发布版本。因此数据库事务提交后页面立即反映新内容：

-无需生成静态 HTML 文件；
-无需写入 `public/`；
-无需 Git commit；
-无需重新构建 Next.js；
-无需重启容器。

### 8.4 TTS

启用且配置有效的 TTS 提供方存在时：

1. 文章事务创建 `QUEUED` 任务；
2. API 立即返回，不等待音频合成；
3. Worker 异步处理任务；
4. TTS 失败不影响文章正文公开；
5. 前端根据任务状态显示不可用、处理中、完成或失败。

## 9. 智能体客户端

### 9.1 首选方式：直接 HTTP

所有语言和智能体平台均以 HTTP API 为正式集成边界。项目应增加 `docs/openapi.yaml`，完整描述：

-接口地址；
-认证方式；
-请求和响应 Schema；
-状态码；
-幂等规则；
-最大请求大小；
-重试规则。

能够发送 HTTP 的智能体无需安装任何项目代码。

### 9.2 辅助方式：零依赖发布客户端

将现有 `scripts/push-article.mjs` 整理为可独立复制的 Node.js 客户端：

```bash
node daily-publish.mjs article.html article.metadata.json
```

客户端只读取：

```dotenv
DAILY_BASE_URL=https://codis.fun/Daily
DAILY_UPLOAD_TOKEN=dk_live_xxx
```

客户端职责：

-读取 HTML 和同名 metadata JSON；
-本地执行基础 Schema 校验；
-将元数据和 HTML 组装成 JSON；
-对规范化请求体计算 SHA-256 幂等键；
-设置请求超时；
-按错误类型决定是否重试；
-输出公开 URL、版本、状态和 `requestId`；
-永不输出令牌、Authorization 请求头或完整正文。

如果需要进一步降低使用门槛，可以在后续发布为 npm CLI，但 npm 包不是服务端发布能力的前置条件。

### 9.3 标准智能体任务约束

智能体任务模板必须明确：

1. 生成 HTML 和 metadata；
2. 不生成 JavaScript、CSS、iframe、表单或 SVG；
3. 图片使用公开 HTTPS URL；
4. 不读取、显示或复制上传令牌；
5. 发布时使用稳定的 `uploaderId + externalId`；
6. 仅在服务器确认成功后报告公开 URL；
7. 认证失败时停止，不尝试绕过校验；
8. 日志只记录安全错误码和 `requestId`。

## 10. 重试和错误处理

| 状态码/情况 | 客户端行为 |
| --- | --- |
| `200/201` | 成功，保存 URL、版本和 `requestId` |
| `400/422` | 输入错误，修正内容后使用新幂等键提交 |
| `401/403` | 停止，通知管理员检查令牌或权限 |
| `409` | 检查幂等键或 `externalId`，禁止盲目重试 |
| `413` | 缩减正文或媒体 |
| `424` | 修正失败的图片源后重新提交 |
| `429` | 遵循 `Retry-After` |
| `500～599` | 保持原请求体和幂等键，指数退避重试 |
| 网络超时 | 保持原请求体和幂等键重试 |

建议默认值：

```text
请求超时：60 秒
最大自动重试：3 次
退避：2 秒、10 秒、30 秒
总任务超时：3 分钟
```

由于服务端可能需要下载图片，上传超时应明显长于普通 JSON API。

## 11. Linux 物理机部署边界

Linux 主机只运行：

- Daily Next.js 应用；
- SQLite 数据库；
-图片和音频持久化目录；
- TTS Worker；
- nginx 和 FRP 客户端；
-健康检查、备份与清理任务。

Linux 主机不运行：

-文章生成智能体；
-内容目录轮询器；
-自动 Git 拉取任务；
-由外部智能体触发的 Docker 构建；
-向智能体开放的远程命令执行服务。

当前 Compose 数据卷 `daily-knowledge-data` 持久化 SQLite、图片和音频。任何人工代码升级都必须保持该卷，不得将数据写入容器临时层。

### 11.1 反向代理要求

nginx/FRP 链路应设置：

-只允许 HTTPS 公网入口；
-合理的请求体上限；
-上传接口较长的读取超时；
-覆盖 `X-Real-IP` 并维护可信代理链；
-不记录 Authorization 请求头；
-对管理后台启用额外访问控制；
-应用端口只监听 `127.0.0.1`。

### 11.2 代码升级

代码升级频率低，继续人工触发。升级流程与内容发布流程完全分离：

```text
内容发布：智能体 HTTPS POST → 数据立即更新
代码升级：管理员登录 Linux → 拉取、构建、健康检查
```

除非未来明确需要，否则不引入自动代码部署。

## 12. 运维与可观测性

### 12.1 健康检查

至少监控：

```text
GET /Daily/api/health/live
GET /Daily/api/health/ready
```

连续失败时通知管理员，不自动执行 Git 拉取或重新构建。可以由 systemd 或 Docker 负责进程级重启。

### 12.2 审计

每次上传记录：

- `requestId`；
- Token ID，不记录完整令牌；
-可信 Uploader ID；
- IP 摘要；
-文章 ID 和版本；
-内容字节数；
-成功或安全错误码；
-接收时间和处理时长。

建议补充指标：

-每小时成功/失败上传数；
-按 Token 的认证失败数；
- `429` 数量；
-图片处理失败数；
- TTS 排队、失败和最长等待时间；
-数据库和数据卷使用量。

### 12.3 备份

每天备份：

- SQLite 数据库及 WAL 一致性快照；
- `data/images/`；
- `data/audio/`；
-必要的非秘密配置；
-单独安全保存 `TTS_MASTER_KEY`。

推荐使用 SQLite 在线备份机制生成一致性数据库副本，再将数据库副本和媒体目录打包。不得只复制主数据库文件而忽略 WAL。

备份至少保留：

```text
每日备份：7 份
每周备份：4 份
每月备份：6 份
```

每月至少执行一次恢复演练，并验证文章、图片和音频均可访问。

### 12.4 清理任务

每日运行低优先级清理任务：

-删除超过 24 小时的上传暂存目录；
-删除无数据库引用且超过安全保留期的媒体；
-删除过期幂等记录；
-按保留策略归档或删除旧审计记录；
-删除超期 TTS 临时文件。

## 13. 安全设计

1. 所有公网提交只允许 HTTPS。
2. 每个智能体独立令牌，最小栏目权限。
3. 令牌只存哈希，明文只显示一次。
4. 令牌可单独禁用、撤销和设置过期时间。
5. 不信任请求体声明的 Uploader ID。
6. HTML 永远经过服务端净化，不直接保存后原样公开。
7. 图片下载执行 SSRF 防护、类型检查和尺寸限制。
8. 使用幂等键避免超时重试生成重复版本。
9. 管理员撤下状态不能被普通智能体覆盖。
10. 应用端口和数据库不直接暴露公网。
11. 日志不记录令牌、Authorization、Cookie 或完整正文。
12. 智能体不获得部署权限、SSH 权限和管理后台会话。

## 14. 实施计划

### 阶段 0：验证现有链路

无需修改代码：

1. 使用高强度共享密码配置现有上传接口；
2. 从一台非 Linux 网站主机调用公网 API；
3. 验证文章立即公开；
4. 验证重复请求的幂等行为；
5. 验证图片转存和 TTS；
6. 建立数据库和媒体备份。

交付结果：少量可信智能体可以开始使用。

### 阶段 1：独立身份认证

1. 新增 `upload_tokens` 和 `upload_token_categories`；
2. 改造 `verifyUploadRequest` 返回 `UploadPrincipal`；
3. 强制校验 Uploader 和栏目权限；
4. 增加 Token/IP 双维度限流；
5. 审计记录关联 Token ID；
6. 增加认证、权限、撤销和过期测试；
7. 保留 Legacy 共享密码兼容开关。

交付结果：任意受信任智能体可使用独立、可撤销凭据。

### 阶段 2：管理能力

1. 管理后台增加 Uploader 列表；
2. 增加令牌创建、查看摘要、禁用、撤销功能；
3. 增加栏目授权和有效期设置；
4. 创建令牌时只返回一次明文；
5. 增加相关管理员审计。

交付结果：无需修改 `.env` 或数据库即可管理智能体。

### 阶段 3：通用客户端

1. 增加 `docs/openapi.yaml`；
2. 整理独立零依赖发布脚本；
3. 更新标准智能体提示词；
4. 实现规范化幂等键、超时和重试；
5. 完成 Windows、Linux 和外部云主机验证。

交付结果：智能体机器不需要克隆网站仓库。

### 阶段 4：运维完善

1. 自动健康检查和异常通知；
2. SQLite 在线备份；
3. 媒体与临时目录清理；
4. TTS 积压和失败告警；
5. 关闭 Legacy 共享密码；
6. 完成恢复演练和安全检查。

## 15. 测试方案

### 15.1 单元测试

- Token 格式解析与哈希验证；
-过期、禁用、错误 Token；
- Uploader 禁用；
-栏目授权；
-输入 Schema；
-幂等冲突；
- HTML 净化和 SSRF 地址判断；
-错误码映射。

### 15.2 集成测试

-有效 Token 创建文章；
-相同请求重放不增加版本；
-修改内容后版本递增；
- PUT 路径与请求体 ID 不一致返回 `409`；
- A Token 冒充 B Uploader 被拒绝；
-跨栏目提交被拒绝；
-撤销 Token 后立即返回 `401/403`；
-图片失败时不改变当前文章版本；
-管理员撤下的文章不能被智能体恢复；
- TTS 不可用时正文仍成功公开。

### 15.3 端到端测试

从 Linux 主机以外的网络执行：

1. 发布一篇带图片文章；
2. 打开响应中的公网 URL；
3. 验证正文已净化；
4. 验证图片由本站地址提供；
5. 重放同一请求并验证版本不变；
6. 修改正文后重新发布并验证版本加一；
7. 重启 Docker 服务并验证文章仍存在；
8. 恢复一份备份并验证数据库、图片和音频。

## 16. 验收标准

满足以下条件后视为方案完成：

-任意外部受信任机器可通过公网 HTTPS 发布文章；
-智能体机器不需要网站仓库、SSH 或数据库权限；
-每个智能体拥有独立、可撤销的令牌；
-服务端可信识别上传者并限制栏目；
-网络超时重试不会产生重复版本；
-提交成功后无需部署、构建或重启即可看到新文章；
-危险 HTML 被移除，远程图片经过安全转存；
-单个智能体可以独立停用，不影响其他智能体；
-管理员撤下状态不会被智能体覆盖；
-上传和 TTS 状态可审计、可监控；
-数据库和媒体具有经过验证的恢复路径；
- Git 不可用时内容发布仍可正常工作。

## 17. 关键决策摘要

| 决策 | 结论 |
| --- | --- |
| 内容传输方式 | 智能体通过公网 HTTPS 主动推送 |
| Linux 主机职责 | 接收、处理、持久化、展示和异步 TTS |
| 是否通过 Git 发布文章 | 否 |
| 文章发布是否重启网站 | 否 |
| 是否自动部署网站代码 | 否，继续人工受控升级 |
| 智能体身份 | 每个智能体独立 Token |
| 权限粒度 | Uploader + 栏目 |
| 去重方式 | `Idempotency-Key` + 请求哈希 |
| 更新定位 | `uploaderId + externalId` |
| 数据存储 | SQLite + 本地持久化媒体 |
| 客户端边界 | HTTP API 为主，独立 CLI 为辅 |

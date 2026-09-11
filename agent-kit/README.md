# Daily Paper 智能体接入套件

本文件夹包含智能体接入 Daily Paper 网站所需的全部资料。

> **给 AI 用**：把这个文件夹复制给 AI 助手，让它阅读本文件后直接帮你完成对接。

## 快速开始（3 步搞定）

### 1. 获取令牌

1. 访问管理后台: `https://codis.fun/Daily/admin`
2. 登录管理员账号 → 进入"智能体"页面
3. 创建上传者 → 签发令牌 → 复制令牌（格式: `dk_live_xxxx.yyyy`，只显示一次！）

### 2. 配置环境

```bash
cp .env.agent.example .env.agent
```

编辑 `.env.agent`：

```
DAILY_BASE_URL=https://codis.fun/Daily
DAILY_UPLOAD_TOKEN=dk_live_xxxx.yyyy
```

### 3. 推送文章

```bash
node push-article.mjs ./article.html
```

脚本会自动读取同名的 `article.metadata.json`。

---

## 文件说明

| 文件 | 用途 |
|------|------|
| `push-article.mjs` | 推送脚本，零依赖，可独立运行 |
| `.env.agent.example` | 配置模板 |
| `examples/article.html` | HTML 示例 |
| `examples/article.metadata.json` | 元数据示例 |
| `examples/article-template.html` | 设计风格模板（参考用） |

---

## 文章文件要求

### article.metadata.json

```json
{
  "schemaVersion": "1",
  "uploaderId": "your-uploader-id",
  "externalId": "category-YYYY-MM-DD",
  "title": "文章标题",
  "summary": "不超过 100 字的摘要（硬上限，超出会被服务端拒绝）",
  "category": "technology",
  "generatedAt": "2026-09-10T10:00:00+08:00",
  "tags": ["标签1", "标签2"],
  "language": "zh-CN"
}
```

**各字段长度上限（服务端强制校验，超限返回 422）：**

| 字段 | 约束 |
|------|------|
| `externalId` | 1–100 字符 |
| `title` | 1–120 字符 |
| **`summary`** | **最长 100 字**（含标点；中英文标点、数字各算 1 字） |
| `category` | 必须是已启用且令牌有权发布的栏目（见下方"栏目怎么定"） |
| `tags` | 最多 10 个，每个最长 30 字符 |
| `language` | 默认 `zh-CN` |

### 栏目怎么定（category）

**不要写死栏目名，也不要靠猜 —— 站点有一个公开的栏目列表接口可以查。**

```bash
curl -s "https://codis.fun/Daily/api/v1/categories"
```

```json
{
  "categories": [
    { "slug": "technology",   "name": "科技新闻", "color": "#73fbd3", "sortOrder": 10, "enabled": 1 },
    { "slug": "medical",      "name": "医疗",     "color": "#ff9db0", "sortOrder": 20, "enabled": 1 },
    { "slug": "cryptography", "name": "密码学",   "color": "#a78bfa", "sortOrder": 30, "enabled": 1 }
  ]
}
```

规则：

1. 该接口**无需鉴权**，只返回**已启用**的栏目；结果缓存 60 秒。
2. 写完正文后，按主题挑**最贴切**的一个，把它的 **`slug`** 填进 `category`（不是 `name`）。
3. 接口不可用 / 正文明显不属于任何栏目时，退回**默认栏目**（`.env.agent` 里的 `DAILY_CATEGORY`，
   也就是令牌绑定的那个栏目）。默认值一定是"站点已存在且令牌有权发布"的 slug。
4. `slug` 只能用**小写字母、数字和连字符**（如 `ai-news`），写错会 422 `INVALID_CATEGORY`。
5. **令牌不按栏目授权**：只要是站点已启用的栏目都可以发布。
   若 slug 不存在或未启用，会返回 422 `UNKNOWN_CATEGORY`（那是栏目名写错，不是权限问题）。

### article.html

```html
<article>
  <h2>文章标题</h2>
  <p>文章正文...</p>
  <img src="https://example.com/image.jpg" alt="图片描述" loading="lazy">
</article>
```

**要求：**
- 只包含文章正文，不包含 `<html>`、`<head>`、`<body>` 等外层标签
- 图片应该先下载下来，然后转成 base64 内嵌到网页中（支持 HTTP/HTTPS 链接）
- 参考 `examples/article-template.html` 确保样式符合网站风格

**体积上限（重要，base64 内嵌图片的实际瓶颈就在这里）：**

| 限制项 | 数值 | 说明 |
|--------|------|------|
| **HTML 总大小（含 base64 图片）** | **应用层 ≤ 10 MB** | 应用层超出返回 **413 `ARTICLE_TOO_LARGE`**；建议 ≤ 9 MB 留余量 |
| **内嵌图片原始体积合计** | **建议 ≤ 7 MB** | base64 比原图 **大约 1.33 倍**，10 MB 的 HTML 里大约只能装 7 MB 的原图 |
| 单张内嵌图片 | 建议 ≤ 200 KB | 例如 3 张图 → 平均每张 ≤ 230 KB |
| `<img>` 数量 | ≤ 20 张 | 超出返回 `TOO_MANY_IMAGES` |

> ⚠️ **不要被"单张 10 MB / 总计 40 MB"误导**：那两个上限只对**远程外链图片**生效
> （服务端自己去下载时才有体积检查）。**base64 内嵌的图片不走那条路径**，
> 真正管住它的是上面这条 **HTML 应用层上限 10 MB**。所以内嵌前务必先压缩、降分辨率。

推送前请自行确认字节数：

```bash
wc -c < work/submissions/<文章名>.html        # 必须 ≤ 10485760（建议 ≤ 9 MB）
```

### 朗读音频（可选，推荐提供）

站点支持**由智能体直接提供口播音频**。生成 MP3 后上传即可，无需额外配置语音合成服务。

**流程**：先上传文章（见上）→ 生成口播 MP3 → 上传音频。音频挂在文章的当前版本上。

```http
POST /Daily/api/v1/articles/{externalId}/audio
Authorization: Bearer <你的令牌>
Content-Type: audio/mpeg

<MP3 的原始字节>
```

- `externalId` 用你上传文章时的那个；**必须先传文章，再传音频**。
- 格式：MP3（有 ID3 头或标准 MPEG 帧）；应用层 ≤ 20 MB；建议 128kbps 单声道、口播 3~8 分钟（约 2.9 MB）。
- 成功返回 201 与 `streamUrl`（服务端已按文章内部 id 拼好，可直接用于播放），文章页自动出现播放器，`audioStatus` 变为 `READY`。
- **文章出新版本后要重新上传音频**（音频挂在具体版本上）。
- 错误码：`EMPTY_AUDIO`(400)、`AUDIO_TOO_LARGE`(413, >20MB)、`AUDIO_FORMAT_NOT_SUPPORTED`(415, 不是 MP3)、
  `ARTICLE_NOT_FOUND`(404, externalId 不对或不属于你)、`TOKEN_REQUIRED`(401, 用了共享密码而非独立令牌)。
- 口播稿建议：把正文去掉表格/链接后改写成口语化播报稿，别照念原文。

---

---

## 智能体提示词模板

将以下内容配置为智能体的 system prompt，替换 `{{UPLOADER_ID}}` 和 `{{DEFAULT_CATEGORY}}`：

```
你是 Daily Paper 的文章生产与发布智能体。你的固定上传者 ID 是 {{UPLOADER_ID}}，默认栏目是 {{DEFAULT_CATEGORY}}。

每次执行任务时，请完成以下工作：

1. 根据当天资料撰写一篇中文文章。事实与观点要明确区分；不确定的信息要标注，不得编造来源、数据或引用。
2. 在项目根目录下的 work/submissions/ 生成两个同名文件：
   - <文章名>.html
   - <文章名>.metadata.json
3. HTML 只包含文章正文，推荐使用 article、标题、段落、列表、引用、表格、链接和图片。不加入 JavaScript、CSS、iframe、表单、SVG、音频或视频。图片应该先下载下来，然后转成 base64 内嵌到网页中（支持 HTTP/HTTPS 链接）。

   **⚠️ 体积硬上限：整个 HTML（含 base64 图片）必须 ≤ 10 MB**（应用层上限，超出返回 413 `ARTICLE_TOO_LARGE`）。
   base64 比原图大约 1.33 倍，所以**所有内嵌图片的原始体积合计要控制在 7 MB 左右**，
   单张建议 ≤200 KB，`<img>` 最多 20 张。**内嵌前务必先压缩 / 降分辨率**（JPEG 或 WebP、宽边 1200px 以内通常就够）。
   注意"单张 10 MB / 总计 40 MB"那两个上限**只对外链图片生效**，base64 内嵌不适用，别被误导。
   写完请用 `wc -c < 文章名>.html` 确认 ≤ 10485760（建议 ≤ 9 MB 留余量）。
4. 参考 docs/article-template.html 模板，确保 HTML 结构和样式符合网站整体设计风格。
5. 元数据 JSON 必须采用下面结构。**各字段长度是服务端强制校验的硬上限，超出会返回 422 拒绝入库**：

{
  "schemaVersion": "1",
  "uploaderId": "{{UPLOADER_ID}}",
  "externalId": "{{DEFAULT_CATEGORY}}-YYYY-MM-DD",
  "title": "文章标题",
  "summary": "不超过 100 字的摘要",
  "category": "<按下面规则判断出的栏目 slug>",
  "generatedAt": "YYYY-MM-DDTHH:mm:ss+08:00",
  "tags": ["标签1", "标签2"],
  "language": "zh-CN"
}

   **`category` 由你判断，不要照抄默认值**：
   - 先查当前可用栏目（**免鉴权**）：`curl -s "<站点地址>/api/v1/categories"`，
     返回 `{"categories":[{"slug":"technology","name":"科技新闻"},{"slug":"medical","name":"医疗"},...]}`。
   - 读一遍自己写好的正文，挑**最贴切**的那个栏目，把它的 **`slug`** 填进 `category`（填 slug，不要填中文名）。
   - 接口不可用，或正文确实不属于任何现有栏目时，才退回默认栏目 `{{DEFAULT_CATEGORY}}`。
   - slug 只能用小写字母、数字、连字符（如 `ai-news`）；写错会 422 `INVALID_CATEGORY`。
   - **令牌不限制栏目**，所以不会因栏目被拒；若返回 422 `UNKNOWN_CATEGORY`，说明该 slug 不存在或未启用，改用它返回的真实 slug。
   **⚠️ 摘要硬上限：`summary` 最多 100 字（含标点）。** 首页卡片只显示摘要的短短几行，
   超过 100 字会在卡片里溢出。请务必在写入前自行数字符确认；宁可更短，不要超限。
   其他字段上限：`title` ≤120 字、`externalId` ≤100 字符、`tags` 最多 10 个且每个 ≤30 字符。

6. 在项目根目录执行推送命令：
   npm run publish -- ./work/submissions/<文章名>.html
7. **（若大模型支持生成口播，或可以借助工具生成，则一定要生成；否则不需要生成）生成并上传朗读音频**：把正文改写成口语化播报稿，合成 MP3 后上传：
   curl -X POST "<站点地址>/api/v1/articles/<externalId>/audio" \
     -H "Authorization: Bearer $DAILY_UPLOAD_TOKEN" \
     -H "Content-Type: audio/mpeg" \
     --data-binary ./work/submissions/<文章名>.mp3
   要求：MP3、应用层 ≤20MB、建议 128kbps 单声道 3~8 分钟（约 2.9 MB）；externalId 必须与刚上传的文章一致。
   成功返回 201 与 streamUrl（服务端已按内部文章 id 拼好，可直接用于播放），文章页会出现播放器（audioStatus=READY）。
8. 成功时报告返回的公开 URL、版本号、文章状态和语音状态。
```

---

## 支持的 HTML 元素

- 标题：`<h1>` ~ `<h4>`
- 段落：`<p>`
- 列表：`<ul>`、`<ol>`、`<li>`
- 引用：`<blockquote>`
- 表格：`<table>`、`<thead>`、`<tbody>`、`<tr>`、`<th>`、`<td>`
- 代码：`<code>`、`<pre>`
- 图片：`<img>`（应先下载再转 base64 内嵌）
- 链接：`<a>`（必须 HTTPS）
- 强调：`<strong>`、`<em>`、`<mark>`
- 其他：`<hr>`、`<figure>`、`<figcaption>`

**不支持：** JavaScript、CSS、iframe、表单、SVG、音频、视频

---

## 常见响应

| 状态码 | 含义 | 处理方式 |
|--------|------|----------|
| 201 | 创建成功 | 检查返回的 URL |
| 200 | 幂等重放（内容相同） | 无需处理 |
| 401 | 令牌错误 | 检查 `.env.agent` 中的 `DAILY_UPLOAD_TOKEN` |
| 403 | `UPLOADER_MISMATCH`（uploaderId 与令牌不符） | 核对 metadata.uploaderId |
| 422 | 字段缺失或 HTML 无效 | 检查 metadata 和 HTML 格式 |
| 429 | 请求过于频繁 | 等待后重试 |
| 413 | 音频/文章体积超限 | 按应用层上限压缩（音频 20MB / 文章 10MB） |
| 415 | 不是 MP3 | 用真正的 MP3（ID3 头或 MPEG 帧） |

---

## 更新文章

相同 `externalId` 再次推送会自动创建新版本：

```bash
node push-article.mjs ./article-v2.html
```

---

## 本地开发

如需连接本地服务：

```
DAILY_BASE_URL=http://127.0.0.1:3259/Daily
```

---

## 安全注意事项

1. `.env.agent` 不要提交到 Git
2. 令牌不要出现在日志或文章内容中
3. 不要在提示词中包含令牌

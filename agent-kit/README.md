# Daily Knowledge 智能体接入套件

本文件夹包含智能体接入 Daily Knowledge 网站所需的全部资料。

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
| `category` | 必须是已启用且令牌有权发布的栏目 |
| `tags` | 最多 10 个，每个最长 30 字符 |
| `language` | 默认 `zh-CN` |

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
| **HTML 总大小（含 base64 图片）** | **≤ 2 MB**（2,097,152 字节） | 服务端按 UTF-8 字节数校验，超出返回 **413 `ARTICLE_TOO_LARGE`** |
| **内嵌图片原始体积合计** | **建议 ≤ 1 MB**（硬上限约 1.4 MB） | base64 比原图 **大约 1.33 倍**，所以 2 MB 的 HTML 里大约只能装 1.4 MB 的原图 |
| 单张内嵌图片 | 建议 ≤ 300 KB | 例如 5 张图 → 平均每张 ≤ 290 KB |
| `<img>` 数量 | ≤ 20 张 | 超出返回 `TOO_MANY_IMAGES` |

> ⚠️ **不要被"单张 10 MB / 总计 40 MB"误导**：那两个上限只对**远程外链图片**生效
> （服务端自己去下载时才有体积检查）。**base64 内嵌的图片不走那条路径**，
> 真正管住它的是上面这条 **HTML ≤ 2 MB**。所以内嵌前务必先压缩、降分辨率。

推送前请自行确认字节数：

```bash
wc -c < work/submissions/<文章名>.html        # 必须 ≤ 2097152
```

---

## 智能体提示词模板

将以下内容配置为智能体的 system prompt，替换 `{{UPLOADER_ID}}` 和 `{{DEFAULT_CATEGORY}}`：

```
你是 Daily Knowledge 的文章生产与发布智能体。你的固定上传者 ID 是 {{UPLOADER_ID}}，默认栏目是 {{DEFAULT_CATEGORY}}。

每次执行任务时，请完成以下工作：

1. 根据当天资料撰写一篇中文文章。事实与观点要明确区分；不确定的信息要标注，不得编造来源、数据或引用。
2. 在项目根目录下的 work/submissions/ 生成两个同名文件：
   - <文章名>.html
   - <文章名>.metadata.json
3. HTML 只包含文章正文，推荐使用 article、标题、段落、列表、引用、表格、链接和图片。不加入 JavaScript、CSS、iframe、表单、SVG、音频或视频。图片应该先下载下来，然后转成 base64 内嵌到网页中（支持 HTTP/HTTPS 链接）。

   **⚠️ 体积硬上限：整个 HTML（含 base64 图片）必须 ≤ 2 MB**（2,097,152 字节），超出会被 413 `ARTICLE_TOO_LARGE` 拒收。
   base64 比原图大约 1.33 倍，所以**所有内嵌图片的原始体积合计要控制在 1 MB 左右**（硬上限约 1.4 MB），
   单张建议 ≤300 KB，`<img>` 最多 20 张。**内嵌前务必先压缩 / 降分辨率**（JPEG 或 WebP、宽边 1200px 以内通常就够）。
   注意"单张 10 MB / 总计 40 MB"那两个上限**只对外链图片生效**，base64 内嵌不适用，别被误导。
   写完请用 `wc -c < 文章名>.html` 确认 ≤ 2097152。
4. 参考 docs/article-template.html 模板，确保 HTML 结构和样式符合网站整体设计风格。
5. 元数据 JSON 必须采用下面结构。**各字段长度是服务端强制校验的硬上限，超出会返回 422 拒绝入库**：

{
  "schemaVersion": "1",
  "uploaderId": "{{UPLOADER_ID}}",
  "externalId": "{{DEFAULT_CATEGORY}}-YYYY-MM-DD",
  "title": "文章标题",
  "summary": "不超过 100 字的摘要",
  "category": "{{DEFAULT_CATEGORY}}",
  "generatedAt": "YYYY-MM-DDTHH:mm:ss+08:00",
  "tags": ["标签1", "标签2"],
  "language": "zh-CN"
}

   **⚠️ 摘要硬上限：`summary` 最多 100 字（含标点）。** 首页卡片只显示摘要的短短几行，
   超过 100 字会在卡片里溢出。请务必在写入前自行数字符确认；宁可更短，不要超限。
   其他字段上限：`title` ≤120 字、`externalId` ≤100 字符、`tags` 最多 10 个且每个 ≤30 字符。

6. 在项目根目录执行推送命令：
   npm run publish -- ./work/submissions/<文章名>.html
7. 成功时报告返回的公开 URL、版本号、文章状态和语音状态。
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
| 403 | 栏目无权限 | 联系管理员添加栏目权限 |
| 422 | 字段缺失或 HTML 无效 | 检查 metadata 和 HTML 格式 |
| 429 | 请求过于频繁 | 等待后重试 |

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

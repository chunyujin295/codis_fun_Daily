# 项目长期约定 — Daily Knowledge / codis.fun/Daily

## 首页结构
- **首页没有 hero，进页面直接是封面卡片（Cover Flow）**。用户明确要求"上来就是卡片"，不要再加回大标题 hero。
- 页面保持在**恰好一屏**：`html.scrollHeight === window.innerHeight`。
  任何新增首页区块都要重新配平 `.coverflow-stage` 的 `--cover-lift`，别引入滚动条。
- 语义上首页仍需有且仅有一个 `h1`（当前是 `sr-only` 的 "Daily Knowledge 每日更新"）。

## 样式分层
- 三个样式表按顺序 import：`globals.css`（基础）→ `coverflow.css`（首页主题层）→ `signature.css`。
  同一选择器可能两边都有定义且值不同，**改样式前先 grep 另一个文件**，否则会"改了没生效"。
  （踩过：`.chip-dot` 尺寸、`.category-chip` 字号、选中态白点。）
- 首页视觉改动优先写在 `coverflow.css`，理解它与 `globals.css` 的覆盖关系。

## 视觉基调
- Apple 风：直角卡片（无圆角矩形）、不透明卡面、多层柔和投影、SF 字体栈、`-webkit-box-reflect` 倒影。
- 倒影遮罩方向是反的：**元素底部不透明、顶部透明**才是"贴卡清晰、向下渐隐"。
- 深色/浅色都要验证；不要写死 `#ffffff`，用 `var(--card)` 之类 token。

## Cover Flow 卡片（`app/coverflow.css`）
- **完整实现与调参说明见 `docs/design/cover-flow-20260911.md`**（三条硬规则、参数表、验收标准、踩坑清单都在里面）。
  改首页视觉前先读它，别凭印象调参数。
- **当前旋转朝向 `--turn: -1`**（用户最终选定）。`1` 是其镜像。
  注：Bramus 的官方 Cover Flow 复刻用的是 `+1` 那套映射（左侧负角），但本项目以 `-1` 的观感为准 ——
  这是个主观可切换项，已做成单一变量，**不要再为此争论或改结构**。
  `--turn` 与 `--shift` 联动：翻向会让投影镜像、侧卡 bbox 外移，换朝向时必须回调 `--shift`。
- **每张卡片自带 `perspective()`**，不要加在父级 `.coverflow-stage` 上（父级透视 + 偏心大转角会把卡片压成细缝）。
- **横向位移必须写在 `perspective()` 左侧**（投影后再平移），否则两端被不同缩放因子剪切、卡片变窄。
- **`--depth` 必须大于 `(卡宽/2)·sinθ`**，让侧卡整体待在中间卡片平面之后；否则侧卡近端跑到中间卡前面、被放大得比中间卡还高。
- 验收标准：侧卡宽高都 < 中间卡，且由中心向外高度单调递减（山丘剪影）；页面始终恰好一屏无横向溢出；
  最外侧卡片右边缘 < 视口半宽（否则被 `overflow: hidden` 硬切）。覆盖到 320px 宽。

## 后台表单 / 校验约定
- **前端 `pattern` 与服务端正则必须共用同一份来源**（`lib/constants.ts`），别各写一份。
  原因：HTML 的 `pattern` 按 RegExp 的 **`v` 标志**编译，**编译失败会被浏览器静默忽略**，
  校验看起来在、实际是空的。字符类里的 `-` 必须写成 `\-`（见 `CATEGORY_SLUG_PATTERN`）。
  回归测试：`tests/category-slug-pattern.test.ts`。
- 后台 API 校验失败时要**回传出错字段名**（`fields: [...]`），否则前端只能显示一个
  `INVALID_CATEGORY` 之类的哑错误，用户无法定位。`call()` 会把它挂到 Error 上。
- 表单控件属性要与服务端 schema 对齐（`maxLength` / `max` / `min`），不要只写一半。

## 本项目调试手段
- 用 `.pet-runs/shots/shoot.mjs`（无头 Chrome + CDP）截图验证视觉改动，详见全局 skill `local-design-screenshots`。
- dev server 带 `basePath: /Daily`，本地地址是 `http://127.0.0.1:3000/Daily`（curl `/` 会 404，别误判）。
- **git 出过一次"引用指向本地不存在的 commit"故障**（2026-09-11）：`refs/heads/main` 指向 `c76caf19`，
  但对象库里没有该 commit（本地历史只到 `be6e99f`），于是 `git status` / `git log` / `git show HEAD:<path>`
  全报 `bad object HEAD` / `could not get object info`，`git stash` 静默失败。
  **不是沙箱读拦截**（pack 文件能读、`verify-pack` 全 ok），也不是 partial clone。
  **修法（安全，只补对象、不动 refs/heads 和工作区）**：`git fetch origin main`。
  远端有该 commit，取回后 `git log/status/diff` 立刻恢复正常。
  以后看到 `bad object HEAD` 先跑 `git ls-remote origin` 确认远端有没有，有就 fetch 回来。
- 另注：仓库里有一批 `refs/codex/turn-diffs/*` 残留引用指向缺失对象（某个工具的遗留，与项目无关），
  会在 fetch/gc 时报 `does not point to a valid object` 并导致 `failed to perform geometric repack`，
  但不影响日常操作。要清理需用户确认（删引用是有破坏性的）。
- 该仓库 `core.autocrlf` 生效，git 触碰文件时会提示 "LF will be replaced by CRLF"，属正常现象。

## 智能体接入：存在两份 agent-kit（重要）
- `D:\Code\codis_fun_Daily\agent-kit` —— 站点源码仓库里的**模板**（改这里 = 改规范源）。
- `D:\Code\workbuddy_daily\agent-kit` —— **智能体实际推送用的工作副本**（非 git 仓库，
  另含 `.env.agent`、`build-article.py`、`work/submissions/`）。
- 两份的 `README.md` / `push-article.mjs` 保持同步（其余文件有意不同：`.env.agent`、examples 等）。
  **修改 agent-kit 的规范/脚本时要两边都改**，否则智能体读到的仍是旧值。
- 元数据字段硬上限：**`summary` ≤100 字**（`lib/constants.ts` 的 `SUMMARY_MAX_LENGTH`，服务端 Zod 校验）、
  `title` ≤120、`externalId` ≤100、`tags` ≤10×30。改这个数字时要同步：`lib/constants.ts`、
  `agent-kit/README.md`（元数据示例 + 智能体提示词模板）、`docs/智能体提交提示词.md`、
  `docs/接口文档.md`、`docs/智能体快速入门.md`、两份 `push-article.mjs`、以及全局 skill `daily-knowledge-push`。
- 服务端 422 响应体只含 `{"error":{"code":"INVALID_ARTICLE"}}`，**不带字段名**；
  所以 `push-article.mjs` 里加了本地预检，超限在发请求前就报明确错误。

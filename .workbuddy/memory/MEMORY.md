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

## 本项目调试手段
- 用 `.pet-runs/shots/shoot.mjs`（无头 Chrome + CDP）截图验证视觉改动，详见全局 skill `local-design-screenshots`。
- dev server 带 `basePath: /Daily`，本地地址是 `http://127.0.0.1:3000/Daily`（curl `/` 会 404，别误判）。

# 首页封面卡片（Cover Flow）实现与使用

> 适用版本：2026-09-11。全部逻辑集中在 `app/coverflow.css`（样式/3D）+ `app/page.tsx`（结构/交互）。
> 这份文档同时面向「改视觉参数的人」和「接手这段代码的人」，包含**必须遵守的三条硬规则**与验收标准。

---

## 1. 它是什么

首页没有 hero，进页面直接是一屏封面卡片轮播（Apple Cover Flow 风格）：

- 中间一张正面朝前的"当前文章"卡片；
- 左右两侧各若干张绕**竖轴**（`rotateY`）立起来的卡片，越远转得越多、也越后退；
- 卡片下方是 `-webkit-box-reflect` 做的倒影；
- 卡片下方一行是标题/摘要/日期（`.coverflow-caption`）与翻页控件（`.coverflow-controls`）。

## 2. DOM 结构与数据来源

```
.coverflow-section            （区块，overflow: hidden）
└── .coverflow-stage          （<button>，position: relative；拖拽/键盘的交互载体）
    ├── .coverflow-floor      （地面阴影）
    └── .cover-card  × N      （每篇文章一张）
        └── .cover-paper      （卡面：不透明背景 + 倒影 + 内容）
            ├── .cover-topline      编号 / 栏目
            ├── .cover-copy         标题 + 摘要
            ├── .cover-rule
            └── .cover-bottomline   日期等
```

卡片由 `app/page.tsx` 里 `visibleTracks.map(...)` 渲染（`visibleTracks` 按当前栏目筛选）。每张卡片的**内联 style** 只注入三个值：

```tsx
style={{
  '--distance': visibleDistance,      // 0 = 中间；1、2、3… = 距离
  '--cover-color': track.color,       // 该栏目的品牌色，卡面底边与光晕用它
  zIndex: visibleTracks.length - distance,   // 中间最高，保证压在两侧之上
}}
```

状态类（由 `offset = index - activeIndex` 决定）：

| class | 含义 |
|---|---|
| `is-active` | `offset === 0`，正中间的卡片 |
| `is-left` / `is-right` | `offset` 为负 / 正，分别在左、右两侧 |
| `is-hidden` | `distance > 3`，`opacity: 0`（仍在 DOM 里，避免布局抖动） |

> `--distance` 会被 `Math.min(distance, 4)` 截断，所以 CSS 里的角度不会无限增长。

## 3. 3D 模型：transform 的顺序是关键

```css
/* .cover-card.is-left / .is-right */
transform: translate3d(calc(±var(--shift) + var(--drag-offset)), 0, 0)
  perspective(var(--persp))
  translateZ(var(--depth))
  rotateY(calc(∓1 * var(--turn) * var(--rot)));
```

**transform 列表从右往左作用**，所以上面这条的实际语义是：

1. `rotateY()` —— 卡片绕**自身中心**转，立起来；
2. `translateZ()` —— 整张卡沿自身法线后退（产生纵深 + 缩小）；
3. `perspective()` —— 以**卡片自身中心**为消失点做透视投影；
4. `translate3d()` —— 最后在**屏幕空间**把投影好的卡片整体横移到位。

### 三条硬规则（违反任何一条都会出可见的 bug）

**规则 1：`perspective` 必须写进每张卡片自己的 transform，不要加在父级 `.coverflow-stage` 上。**
父级透视的消失点在舞台中心；侧边卡片被 `--shift` 推到离中心约 250px 处再转 60° 以上，
等于用极偏的视角看一块斜面板，`matrix3d` 实测会被压成 **98px / 37px** 的细缝，看起来像"卡片消失了"。
（本项已踩过：先用父级 `perspective: 1500px`，侧卡几乎看不见。）

**规则 2：横向位移（`translate3d`）必须写在 `perspective()` 的左边。**
若写成 `perspective(d) translate3d(S,0,0) rotateY(θ)`，卡片偏心后左右两端的 z 不同，
同一个 `S` 会被两个不同的 `d/(d−z)` 因子放大/缩小，两端相向收敛 —— 52° 时本应 242px 宽的卡片只剩 **157px**。
（本项已踩过。）

**规则 3：`--depth` 必须大于 `(卡宽/2) · sin(转角)`。**
近端深度 `z = --depth + (卡宽/2)·sinθ`。若 `z > 0`，侧卡的近端会跑到中间卡片所在平面（z=0）**前面**，
被透视放大得**比中间卡片还高**（实测 `--depth: -70px`、θ=64° 时近端 z=+118.7 → 高 477 > 中间 420）。
苹果 Cover Flow 里侧边封面**永远比中间小**，所以这条是硬约束。
当前用「按卡宽取比例」的写法自动满足，并让视口压小卡片时比例不失真：

```css
--persp: calc(var(--card-size) * 2.4);
--depth: calc(var(--distance, 0) * var(--card-size) * -0.57);
```

**还有一个前提：`transform-origin` 必须恒定落在舞台中心。**
卡片用**负外边距**居中布局盒子（而不是 `translate(-50%)`）：

```css
margin-top: calc(var(--card-size) / -2);
margin-left: calc(var(--card-size) / -2);
```

因为 `transform-origin` 指的是**布局盒子中心**。若靠 `left:50% + translate(-50%)` 居中，
盒子中心会偏在舞台中心右侧半个卡宽处，左右两张卡片的透视眼点相差一个卡宽以上，**左右就不对称了**。
用负外边距后 `transform-origin` 恒等于舞台中心，`translate3d` 里也不用再写 `-50%`。

## 4. 全部可调参数

| 变量 | 当前值（桌面） | 作用 | 调整建议 |
|---|---|---|---|
| `--turn` | `-1` | **旋转朝向开关**：`-1`＝苹果方向（左侧卡 `rotateY` 正、右侧卡负）；`1`＝其镜像 | 只改这一个数字即可整体翻转，不用动 transform |
| `--rot` | `calc(56deg + var(--distance,0) * 8deg)` | 转角；d1→64°、d2→72° | 想更"激进"就调大基准值；越大侧卡越窄越难辨认 |
| `--shift` | `calc(58% + (var(--distance,1) - 1) * 24%)` | 屏幕空间横向间距（% 相对卡宽） | 与 `--turn` 联动，见 §5 |
| `--depth` | `calc(var(--distance,0) * var(--card-size) * -0.57)` | 纵深后退量 | 系数绝对值必须 > `0.5·sinθ ≈ 0.45`；调节它会同时改变侧卡大小 |
| `--persp` | `calc(var(--card-size) * 2.4)` | 透视距离 | 越小透视越夸张（近端更大、远端更小） |
| `--cover-lift` | `220px` | 页面里除卡片外占掉的垂直空间（页头 68 + 筛选栏 52 + 留白 ~50 + 翻页器 ~47） | 改了页头/翻页器高度要同步改，否则不再恰好一屏 |
| `--card-size` | `min(clamp(16rem,34vw,28.5rem), calc((100svh - var(--cover-lift)) / 1.62))` | 卡片宽（=高，`aspect-ratio: 1`） | 双约束：既受宽度限制，也受视口高度限制 |
| `--drag-offset` | 运行时注入 `px` | 拖拽时的横向跟随位移 | 由 React 写入，别手改 |

侧卡的弱化效果：`opacity: calc(0.98 - var(--distance) * 0.09)`、`filter: saturate(0.88) brightness(0.97)`。

## 5. 旋转朝向（`--turn`）与间距的联动

`--turn` 会让投影在**卡片自身坐标系里镜像**，所以翻转朝向时：

- 内、外侧边交换 —— 原来"内侧边离观察者更近"会变成"外侧边更近"；
- 结果是侧卡的 **bbox 会整体外移**，`--shift` 不变时"后叠量"（内侧边压住中间卡片多少）会明显变小。

实测（1440×900）：`--turn: 1` 时 d1 内边缘在 181（压住 29px），`--turn: -1` 时同样的 `--shift` 下变成 204（只压住 6px），
所以把 `--shift` 从 `64%+25%` 回调到 `58%+24%` 恢复观感。**换 `--turn` 后务必回头核一下后叠量。**

窄屏同样要跟着收（`--turn: -1` 朝外张得更开）：

```css
@media (max-width: 760px) {
  .coverflow-stage { --card-size: clamp(11rem, 58vw, 19rem); }
  .cover-card {
    --rot: calc(48deg + var(--distance, 0) * 7deg);
    --shift: calc(48% + (var(--distance, 1) - 1) * 12%);
  }
}
```

> 关于"哪边才是苹果原生方向"存在两种相反写法。Chrome 团队 Bramus 的官方 Cover Flow 复刻
> （scroll-driven-animations.style）用的是 `0% translateX(-100%) rotateY(-45deg)` → `100% translateX(100%) rotateY(45deg)`，
> 即**左侧负角**，对应本项目的 `--turn: 1`；本项目最终选定 `--turn: -1`（观感为准）。
> 结论：这是个**主观可切换项**，已做成一个变量，别再为它纠结结构。

## 6. 版面约束：恰好一屏

首页硬要求 **不出现滚动条**（`document.documentElement.scrollHeight === window.innerHeight`）。三处配合：

1. `.site-shell` 是 `display: flex; flex-direction: column; min-height: 100svh`；
2. `.coverflow-section` 是 `flex: 1 0 auto; min-height: 0` —— **不能写成 `flex: 1`**，
   否则空间不足时区块被压缩，`overflow: hidden` 会把倒影和翻页器切掉；
3. `.coverflow-stage` 高度 = `var(--card-size) * 1.62`，而 `--card-size` 里已经用
   `calc((100svh - var(--cover-lift)) / 1.62)` 做了高度约束 —— 多余的高度是用来放倒影的。

**改页头/筛选栏/翻页器的高度时，必须同步更新 `--cover-lift`。**

## 7. 倒影

```css
.cover-paper {
  -webkit-box-reflect: below 7px
    linear-gradient(to bottom,
      rgb(0 0 0 / 0%) 0%, rgb(0 0 0 / 0%) 46%,  /* 贴卡一端透明 */
      rgb(0 0 0 / 5%) 56%, rgb(0 0 0 / 13%) 67%, rgb(0 0 0 / 25%) 78%,
      rgb(0 0 0 / 40%) 89%, rgb(0 0 0 / 58%) 100%);
}
```

**遮罩方向是反的**：渐变在**元素自身坐标系**里定义，然后跟着倒影一起被翻转，
所以"元素**底部**不透明、顶部透明"才等于"贴卡处清晰、向下渐隐"。写反了会看到
"倒影紧贴卡片处完全看不见、远处才冒出来"，很容易误判成浏览器不支持。
`.cover-card:not(.is-active) .cover-paper` 与 `.dark` 各有单独覆盖（深色底需要更强的倒影才看得见）。
Firefox 不支持该属性。

> 倒影高度 = 元素高度，会吃掉版面高度。侧卡因为被透视放大会更高，其倒影会落到区块裁切线以下 ——
> 也就是说**只有中间卡片看得到倒影**，这是当前一屏约束下的既定取舍，不是 bug。

## 8. 卡片内的字号

`.cover-card` 上有 `container-type: inline-size`，卡内标题用 `font-size: 10cqw`（`cqw` = 卡片宽的 1%），
所以卡片被视口高度压小时标题会跟着缩，不会溢出或莫名折行。
`cqw` 前保留了 `clamp()` 作为不支持容器查询时的兜底。

注意：**容器查询单位取的是布局尺寸，不受 3D 变换影响** —— 侧卡虽然被透视压窄了，
字号仍按原卡宽计算，文字会跟着卡片一起变形，这正是想要的效果。

## 9. 交互

| 操作 | 实现 |
|---|---|
| 鼠标滚轮 | `.coverflow-stage` 上的 `wheel` 监听（`passive: false`，会 `preventDefault` 拦掉页面滚动） |
| 拖拽 | `pointerdown/move/up`，写入 `--drag-offset`；松手时按位置阈值判定：`< 38%` 上一张、`> 62%` 下一张 |
| 键盘 | 舞台是 `<button>`，`←/↑` 上一张、`→/↓` 下一张、`Home/End` 跳首尾 |
| 翻页控件 | `.coverflow-controls` 里的「上一篇 / 下一篇」按钮 |
| 无障碍 | 舞台有 `aria-label` 说明当前第几篇；非当前卡片 `aria-hidden` |

切换时靠 `transition: transform 620ms cubic-bezier(0.22, 0.82, 0.24, 1)` 过渡；
拖拽期间 `.coverflow-stage.is-dragging .cover-card { transition: none }` 保证跟手不卡顿。

## 10. 验收标准

改完这套参数后，**必须**满足：

**几何（用浏览器控制台或调试脚本量）**

1. 侧卡 **宽和高都小于**中间卡片（若侧卡更高 → 违反规则 3，`--depth` 不够）；
2. 由中心向外，卡片高度**单调递减**（中间 420 → d1 400 → d2 329 这种"山丘"剪影），
   而不是中心凹下去或侧卡冒尖；
3. 左右**精确镜像**：`L[-179,-331] ↔ R[179,331]`；
4. 侧卡内边缘**压住**中间卡片一段（"后叠量"约 20–35px），不是平铺在旁边。

**版面（至少覆盖这些视口）**

5. `document.documentElement.scrollHeight <= innerHeight`（恰好一屏，无纵向滚动）；
6. `document.documentElement.scrollWidth <= innerWidth`（无横向滚动）；
7. **最外侧卡片右边缘 < 视口半宽**（否则会被区块的 `overflow: hidden` 硬切一条边）。

建议覆盖 1440×900、1280×800、1024×768、768×1024、430×932、414×896、390×844、375×667、360×740、320×640。
当前实测余量 15–325px 全部为正。

## 11. 怎么验证（不靠肉眼）

3D 变换出错时，"看起来怪"很难定位。用 `matrix3d` **反推**比截图更可靠：

```js
const card = document.querySelector('.cover-card.is-right');
getComputedStyle(card).transform;      // matrix3d(...) 列主序
card.getBoundingClientRect();          // 变换后的实际包围盒
```

- `matrix3d` 是**列主序**，`m11` 的 z 分量就是 `-sin(rotateY)`，可直接反查实际转角
  （例：`m11 = 0.587785` → `acos = 54°`，用来确认 CSS 变量链路没算错）；
- 手算投影：点 `(X,0,0)` 先 `rotateY(θ)` → `(X·cosθ, 0, −X·sinθ)`，叠 `translateZ` 后
  代入 `x_screen = x · d / (d − z)`。四个角都算一遍取 min/max 就是包围盒，
  和 `getBoundingClientRect()` 对比应能**亚像素吻合**。

> 本项目另有一个本地无头 Chrome + CDP 的截图/探针小工具（`shoot.mjs`，只在本地开发时用，未入库），
> 用法与坑记录在全局 skill `local-design-screenshots` 里。

## 12. 已踩过的坑（速查）

| 现象 | 根因 | 修法 |
|---|---|---|
| 侧卡被压成细缝 | `perspective` 加在父级 | 每张卡自带 `perspective()`（规则 1） |
| 侧卡比预期窄很多 | 横向位移写在 `perspective()` 里面 | 移到 `perspective()` 左侧（规则 2） |
| 侧卡比中间卡片还高 | `--depth` 不够，近端跑到中间卡前面 | 让 `|--depth| > (卡宽/2)·sinθ`（规则 3） |
| 左右不对称 | `transform-origin` 没落在舞台中心 | 改用负外边距居中布局盒子 |
| 倒影贴卡处看不见、远处才出现 | `-webkit-box-reflect` 遮罩方向写反 | 元素底部不透明、顶部透明 |
| 页面出现滚动条 / 倒影被切 | `.coverflow-section` 被压缩 | `flex: 1 0 auto`（不能只写 `1`） |
| 改了样式"没生效" | 项目是 `globals.css` + `coverflow.css` 双层样式表 | 先 grep 另一个文件，用 `getComputedStyle` 读实际值 |
| 换了 `--turn` 后侧卡位置怪 | 投影镜像导致 bbox 外移 | 同步回调 `--shift`（§5） |

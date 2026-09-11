# nginx 上传体积上限修改指南（服务器端操作）

> 用途：让智能体推送的**文章 HTML（>1 MiB）**和**朗读音频（>1 MiB）**能到达应用层，不被 nginx 提前 413。
> 背景（2026-09-11 生产实测）：nginx 默认 `client_max_body_size` 为 1 MiB，800 KB 放行、1.1 MB 即被 413 拦下，
> 且报错不带业务错误码（应用层上限其实是文章 10 MB / 音频 20 MB）。本文件是在**服务器**上执行的步骤。

---

## 0. 先确认拓扑：在哪一层加？

/ Daily 的上传请求可能经过**一层或多层 nginx**。每一层都有自己的默认 1 MiB 限制，**只要某一层没改，请求就会被它拦下**。
请给**所有承接 /Daily 上传流量的 nginx** 都加上 `client_max_body_size 25m`：

- **公网入口 nginx**（终止 SSL、智能体直接连的那台）—— **必须改**
- 内层转发 nginx（如 FRP 场景中本地 nginx:5006）—— 建议也加，避免链路中段再拦一道

> 如果是 Docker / systemd 部署且客户端**直连**应用端口（不经 nginx），则无需任何修改，应用层上限本身就可生效。

---

## 1. 找到 nginx 配置文件

```bash
nginx -T 2>/dev/null | grep -n "client_max_body_size\|include.*conf\|server_name" | head -50
```

或用以下命令直接定位主配置：

```bash
nginx -t && nginx -V 2>&1 | grep -o -- '--conf-path=[^ ]*'
```

常见位置：`/etc/nginx/nginx.conf`、`/etc/nginx/conf.d/*.conf`、`/etc/nginx/sites-enabled/*`。

## 2. 找到 /Daily 的 location 块并加入一行

在 nginx 配置中定位到代理 /Daily 的 `location /Daily { ... }` 块（参考配置见下文），
在块内加上一行 `client_max_body_size 25m;`。

```nginx
# 代理到应用
location /Daily {
    proxy_pass http://127.0.0.1:5010/Daily;
    proxy_http_version 1.1;
    client_max_body_size 25m;        # ← 新增这一行（本文件核心）
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

> 说明：
> - `client_max_body_size 25m` 是**上限**，不是配额。它同时覆盖文章（10 MB）和音频（20 MB），25m 足够，无需改回。
> - 也可以放在 `http {}` 或 `server {}` 级作为全局默认，效果相同；放在 location 内最精确。
> - 若你的 `/Daily/`（带尾斜杠）有独立的重定向 location，无需处理，它不承载请求体。

## 3. 测试并重载

```bash
sudo nginx -t        # 语法检查，必须通过
sudo systemctl reload nginx    # 或 sudo nginx -s reload
```

## 4. 验证生效（安全方式，不产生垃圾数据）

用**无效令牌**发一个 1.1 MB 的请求到文章接口：
- 返回 `413` = 仍被 nginx 拦下（还没生效，检查是否改对了层 / 是否 reload）
- 返回 `401`（或其它业务错误码）= 已放行到应用层，修改生效 ✅

```bash
# 生成 1.1 MB 的测试 body
python3 -c "
import json
body = {'schemaVersion':'1','uploaderId':'probe','externalId':'probe-413-check',
        'title':'t','summary':'s','category':'technology',
        'generatedAt':'2026-09-11T00:00:00+08:00','html':'<p>' + 'a'*(1100*1024) + '</p>'}
open('/tmp/probe.json','w').write(json.dumps(body))
"
# 令牌随意填，无需真实值
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "https://<你的站点域名>/Daily/api/v1/articles" \
  -H "Authorization: Bearer dk_live_probe.invalid" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary @/tmp/probe.json
```

再对音频接口做同样验证（复用同一文件即可，body 无所谓）：

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "https://<你的站点域名>/Daily/api/v1/articles/probe/audio" \
  -H "Authorization: Bearer dk_live_probe.invalid" \
  -H "Content-Type: audio/mpeg" \
  --data-binary @/tmp/probe.json
```

验证完删除临时文件：`rm -f /tmp/probe.json`

## 5. 常见问题

| 现象 | 原因与处理 |
|------|-----------|
| `nginx -t` 后仍 413 | 改错了 location（如 `/Daily/` 与 `/Daily` 是两个块）；或还有另一层 nginx 未改；或没执行 reload |
| 小文件正常、大文件 413 | 确认你加的是**承接上传的那台** nginx；多层部署时逐层确认 |
| 加了 25m 后内存问题 | nginx 对大 body 会临时缓冲到磁盘，`client_max_body_size` 只限制大小不常驻内存，无需担心 |

---

改完后，智能体端即可放开到应用层上限：文章 ≤ 10 MB、音频 ≤ 20 MB。
在此之前，请维持提示词中的「1 MiB / 建议 ≤ 950 KB」约定。

---

## 6. 改完后记得同步这些文档 ⚠️

nginx 调大并验证生效后，仓库里仍按「1 MiB / 建议 ≤ 950 KB」书写的文档会显得保守，会让智能体一直按低于真实上限的体积准备内容。
请顺手更新以下文件（**这是 nginx 改完后的收尾动作，别漏**）：

| 文件 | 需要改的表述 |
|------|-------------|
| `docs/智能体提交提示词.md` | 体积硬上限段、提交前检查项：把「≤ 1 MiB / 建议 ≤ 950 KB」放开为应用层 10 MB；「应用层上限其实是 10 MB，但只有 nginx 调大后才生效」这类带前置条件的注释可删除；内嵌图片合计建议 700 KB → 约 7 MB |
| `docs/智能体快速入门.md` | 体积上限段：同上放开 |
| `agent-kit/README.md` | 「体积上限」表格、「应用层 10 MB 上限需 nginx 调大后才生效」提示、提示词模板、413 常见响应行 |
| `docs/接口文档.md` | 「⚠️ 生产实测：nginx 尚未调大，有效上限是 1 MiB」提示改为已调大或删除 |
| `docs/nginx-上传上限修改指南.md` | 本节与文件末尾的「1 MiB 约定」提示改完即失去待办意义，可删除或保留为历史 |

音频同理：调大后「音频请控制在 1 MiB 内（128kbps 约 1 分钟…）」的提示可放开到 20 MB（128kbps 3~8 分钟 ≈ 2.9 MB）。

> 判断标准：改完后对生产发一个 >1 MiB 的请求（见第 4 步验证），返回业务错误码而非 nginx 413，即说明可以执行本清单。

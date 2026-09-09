# Linux、Docker 与 FRP 部署

## 1. 环境准备

```bash
cp .env.example .env
```

编辑 `.env`，设置以下必填项：

| 变量                           | 说明                                         |
| ------------------------------ | -------------------------------------------- |
| `ADMIN_PASSWORD`               | 管理员密码，首次启动写入慢散列               |
| `UPLOAD_PASSWORD`              | 迁移期智能体共享上传密码，首次启动写入慢散列 |
| `ALLOW_LEGACY_UPLOAD_PASSWORD` | 全部智能体改用独立令牌后设置为 `false`       |
| `TTS_MASTER_KEY`               | 32 字节随机值的 Base64，加密讯飞凭据         |
| `PUBLIC_BASE_URL`              | 站点公网地址，如 `https://codis.fun/Daily`   |

> 正式使用前必须轮换曾在聊天或截图中出现过的讯飞凭据。

服务启动后，管理员应在 `/Daily/admin` 的“智能体”页为每个远程智能体签发独立令牌，并限定允许发布的栏目。独立令牌明文只显示一次。

## 2. Docker 部署（推荐）

```bash
docker compose up -d --build
docker compose ps
```

应用默认监听 `127.0.0.1:3000`。修改端口：

```bash
DAILY_PORT=5010 docker compose up -d --build
```

数据持久化在 Docker 卷 `daily-knowledge-data` 中，包含 SQLite、图片和音频。

## 3. npm 部署

```bash
npm ci
npm run build
PORT=5010 HOSTNAME=0.0.0.0 npm run start
```

### systemd 服务（生产推荐）

创建 `~/.config/systemd/user/daily.service`：

```ini
[Unit]
Description=Daily Knowledge Timeline
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/codis_fun_Daily
Environment=PORT=5010
Environment=HOSTNAME=0.0.0.0
Environment=DATA_DIR=/path/to/codis_fun_Daily/data
Environment=DATABASE_PATH=/path/to/codis_fun_Daily/data/daily-knowledge.db
ExecStart=/usr/bin/node node_modules/next/dist/bin/next dev --port 5010 --hostname 0.0.0.0
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
```

启用：

```bash
systemctl --user daemon-reload
systemctl --user enable --now daily
systemctl --user status daily
```

查看日志：

```bash
journalctl --user -u daily -f
```

## 4. nginx 反向代理

在现有站点的 nginx 配置中添加：

```nginx
# 尾斜杠重定向到无尾斜杠
location = /Daily/ {
    return 301 /Daily;
}

# 代理到应用
location /Daily {
    proxy_pass http://127.0.0.1:5010/Daily;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

修改后重载：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 5. FRP 内网穿透

### 拓扑

```text
用户 → https://codis.fun
     → 云服务器 nginx (SSL 终止)
     → frps → 加密隧道
     → 本地 frpc → nginx:5006 → 应用:5010
```

### frpc 客户端配置

```toml
[[proxies]]
name = "codis-daily"
type = "http"
localIP = "127.0.0.1"
localPort = 5006
customDomains = ["codis.fun"]
```

frpc 将 `codis.fun` 的所有流量转发到本地 nginx 5006 端口，nginx 再根据路径分发到各个服务。

### 云服务器 nginx 配置

公网服务器需配置 SSL 证书和 FRP 转发，具体参见已有的 `codis-fun` 站点配置。

## 6. 备份与恢复

备份内容：

- `data/daily-knowledge.db`（SQLite + WAL）
- `data/images/` 与 `data/audio/`
- `.env`（非秘密部分）
- `TTS_MASTER_KEY`（单独安全保管）

恢复后验证：

```bash
curl http://127.0.0.1:5010/Daily/api/health/ready
```

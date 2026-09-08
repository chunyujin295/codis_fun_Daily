# Linux、Docker 与 FRP 部署

## 1. 环境与秘密

复制 `.env.example` 为 `.env`，设置至少：

- `ADMIN_PASSWORD`：首次启动时写入慢散列；之后可移除明文环境变量。
- `UPLOAD_PASSWORD`：首次共享上传密码；之后可在后台轮换。
- `TTS_MASTER_KEY`：32 字节随机值的 Base64，用于加密讯飞凭据。必须单独备份且不能提交 Git。

截图或聊天中出现过的讯飞凭据应先在控制台轮换，再通过后台录入新值。

## 2. npm 运行

```bash
npm ci
npm run db:migrate
npm run build
npm run start
```

生产环境建议以 systemd 管理 `npm run start`，并确保 Linux 主机启用时间同步。应用默认只监听 `127.0.0.1:3000`。

## 3. Docker 运行

```bash
docker compose up -d --build
docker compose ps
```

Compose 只把应用映射到宿主机 `127.0.0.1:3000`。SQLite、图片和 MP3 存放在 `daily-knowledge-data` 持久卷中。

## 4. FRP 拓扑

```text
互联网 → codis.fun:443 → Nginx/Caddy → 127.0.0.1:18080
         → frps → 加密隧道 → Linux frpc → 127.0.0.1:3000
```

公网服务器只开放 80/443 和受保护的 FRP 控制端口。`18080`、FRP Dashboard 和应用端口不得直接暴露公网。FRP token、共享上传密码、管理员密码、TTS 主密钥和讯飞凭据必须互不复用。

公网 Nginx 核心配置：

```nginx
location = /Daily {
    return 308 /Daily/;
}

location ^~ /Daily/ {
    client_max_body_size 3m;
    proxy_pass http://127.0.0.1:18080;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Port  443;
    proxy_set_header X-Forwarded-Prefix /Daily;
    proxy_set_header X-Forwarded-For   $remote_addr;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Request-ID      $request_id;
}
```

`proxy_pass` 末尾不能增加 `/`，否则可能剥离 `/Daily`。TLS 证书和 HTTP 限流由公网反向代理统一处理。

## 5. 备份与恢复

备份应包含：

- SQLite 数据库及 WAL 一致性备份；
- `data/images` 与 `data/audio`；
- 非秘密部署配置；
- 单独安全保管的 `TTS_MASTER_KEY`。

恢复后依次验证 `/Daily/api/health/ready`、匿名文章阅读、图片与 MP3 Range 播放。讯飞服务故障不会令整站 readiness 失败。

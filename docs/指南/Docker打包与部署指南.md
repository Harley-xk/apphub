# Docker 打包与部署指南

apphub 提供两种可选部署方案：[发布包直部署](发布包打包与部署指南.md)（**主方案**）与 **Docker 镜像部署**（本指南，备选），选型对比与当前结论见[发布包打包与部署指南 §1](发布包打包与部署指南.md#1-方案选型)。本指南是 docker 打包编译工具链与服务器部署的唯一设计依据：镜像结构、构建流程、流水线接入、服务器初始化与日常发布 / 回滚操作均以本文为准。

## 1. 部署形态与网络拓扑

```mermaid
flowchart TB
    Browser["浏览器"] -->|"HTTPS / HTTP"| Nginx["Ubuntu 服务器 · 全局 nginx（已有）<br/>deploy/nginx-gateway.conf.example"]
    Nginx -->|"proxy_pass http://127.0.0.1:8080"| Container["Docker 容器 apphub<br/>（前后端单镜像，镜像内 nginx :80）"]
    Container -->|"静态资源 /usr/share/nginx/html<br/>（SPA，try_files 回退）"| Static["前端产物（镜像内）"]
    Container -->|"/api、/api-docs 反代"| Nest["容器内 NestJS<br/>node dist/main.js :3000"]
    Nest --> DB[("外置 PostgreSQL（DB_* 配置指向）")]
```

要点：

- **两级 nginx**：服务器全局 nginx 只认一个 upstream（`127.0.0.1:8080`），不感知容器内部结构；镜像内 nginx 负责静态资源与 API 分流（对比发布包直部署方案多一层镜像内 nginx）。镜像自包含，可整体迁移。
- **入口脚本**：容器启动时 `entrypoint.sh` 依次执行——用 `pg` 探测数据库连通性（每 2 秒重试，超时上限 `DB_WAIT_TIMEOUT`，默认 120s）→ 执行迁移（ADR-005）→ 拉起 nginx → `exec node dist/main.js` 作为 PID 1（`docker stop` 的 SIGTERM 直达应用进程，触发 `enableShutdownHooks` 优雅关停）。迁移失败时容器启动即退出，由 `restart: unless-stopped` 自动重试，故障显性化。
- **端口仅本机监听**：compose 将容器 80 映射到 `127.0.0.1:8080`，外部无法绕过全局 nginx 直连容器。
- **数据库外置**：容器经 `DB_*` 环境变量连接外部 PostgreSQL；数据库与服务器同机时 `DB_HOST` 填 `host.docker.internal`（compose 已配置 host-gateway 映射）。
- **配置外置**：`deploy/server.env` 放服务器工作目录，经 compose `env_file` 注入容器——容器启动时读取宿主机文件，镜像内不含任何环境差异配置。
- **健康检查**：后端 `/api/health` 为 `@Public` 健康检查接口（`app.controller.ts`），compose 以 `wget http://127.0.0.1/api/health` 探活（经镜像内 nginx 转发到应用）。

## 2. 工具链文件清单

| 文件 | 职责 |
| --- | --- |
| `Dockerfile`（根） | 多阶段构建：依赖安装 → 前后端编译 → 生产依赖提取 → 运行时镜像组装 |
| `.dockerignore`（根） | 排除 `.git`、`node_modules`、`dist`、`server/.env` 等，瘦身构建上下文并防止配置泄入镜像 |
| `docker/nginx.conf` | 镜像内 nginx 站点配置：静态资源缓存、SPA 回退、`/api` 反代 |
| `docker/entrypoint.sh` | 容器入口：等数据库 → 跑迁移 → 起 nginx → exec node（PID 1，SIGTERM 优雅关停） |
| `deploy/docker-compose.yml` | 服务器运行编排：端口映射、env_file、健康检查、重启策略（放 `/opt/apphub/`） |
| `deploy/server.env.example` | 外置运行配置模板（复制为 `server.env` 后修改，放 `/opt/apphub/`） |
| `deploy/nginx-gateway.conf.example` | 服务器全局 nginx 站点配置示例（含 443 与 acme.sh 证书用法，纯转发到容器 8080） |
| `deploy/deploy.sh` | 部署阶段执行脚本：`docker load` + `docker compose up -d` + 清理悬空层 |

## 3. 镜像设计

### 3.1 多阶段构建（Dockerfile）

```mermaid
flowchart LR
    A["阶段 build<br/>全量安装依赖 → 构建前端<br/>（注入 VITE_SIGN_SECRET）<br/>→ 构建后端（nest build → dist）"] --> B["阶段 prod-deps<br/>仅安装 server 生产依赖<br/>（--prod，不含 devDependencies）"] --> C["运行时镜像<br/>node:22-alpine + nginx<br/>workspace 依赖布局 + 前后端 dist<br/>+ nginx 配置与入口脚本"]
```

- 基础镜像 `node:22-alpine`、pnpm 锁 `11.6.0`，与开发环境（node 22 + pnpm 11）对齐——pnpm 11 的 lockfile 须同代 pnpm 消费。
- pnpm workspace 的 `server/node_modules` 以符号链接指向根 `node_modules/.pnpm`，运行时镜像按 workspace 布局整体拷贝（`COPY --from=prod-deps /app /app`），工作目录 `/app/server`。
- 前端签名密钥经构建参数注入：`VITE_SIGN_SECRET` 未传时回退到与 `web/.env.production` 相同的占位值（Vite 规则：进程环境变量优先于 `.env` 文件）。
- apk 源换为阿里云镜像（`dl-cdn.alpinelinux.org` 国内网络可达性差）。

## 4. 服务器初始化（一次性）

以下命令在 Ubuntu 服务器上以 root / sudo 执行，文件内容取自仓库 `deploy/` 目录：

```bash
# 1. 安装 Docker（已装可跳过；官方源自带 docker compose 插件）
curl -fsSL https://get.docker.com | sh

# 2. 创建部署目录，放入编排与配置文件（文件内容取自仓库 deploy/ 目录）
mkdir -p /opt/apphub/pay-certs
#   - deploy/docker-compose.yml      → /opt/apphub/docker-compose.yml
#   - deploy/server.env.example      → /opt/apphub/server.env（务必修改占位值）
vim /opt/apphub/server.env

# 3. 全局 nginx 站点配置（示例已含 443 与 acme.sh install-cert 用法，按域名 / 证书路径补全后拷入 conf.d）
#   deploy/nginx-gateway.conf.example → /etc/nginx/conf.d/apphub.conf
nginx -t && nginx -s reload

# 4. 首次拉起（镜像由部署脚本加载后自动完成；也可先手动拉起验证链路）
docker compose -f /opt/apphub/docker-compose.yml up -d
```

`/opt/apphub/pay-certs/`：支付商户 PEM 证书目录（M5 渠道资质就绪后放微信 `apiclient_key.pem`、支付宝应用私钥 / 公钥），compose 已挂载为容器内同路径，`server.env` 中 `*_PRIVATE_KEY_PATH` / `*_PUBLIC_KEY_PATH` 直接填服务器路径（与主方案发布包直部署共用，见[发布包打包与部署指南 §8](发布包打包与部署指南.md#8-配置参考serverenv)）。

`server.env` 必改项见 [§7 配置参考](#7-配置参考serverenv)；占位密钥未改时应用会启动失败（fail-fast 校验），属预期防护。

## 5. CI/CD 流水线接入

工具链不绑定具体平台（主流 CI/CD 均可接入），流水线按通用三段形态组织：

```mermaid
flowchart LR
    Repo["代码仓库<br/>push 触发"] --> Build["构建阶段<br/>需 docker CLI 与 daemon"]
    Build -->|"docker build + docker save"| Artifact["产物归档<br/>apphub-image.tar.gz + deploy/ 目录"]
    Artifact -->|"CI 产物库 / scp / rsync"| Deploy["目标服务器<br/>产物目录执行部署脚本"]
    Deploy -->|"sh deploy/deploy.sh"| Done["load 镜像 → compose up -d → 清理悬空层"]
```

接入要点：

1. **触发**：代码 push 到 `main` 分支（或各平台等价机制）。
2. **加密变量**：`VITE_SIGN_SECRET`——值为前端签名密钥，**必须与 `server.env` 中 `SIGNATURE_SECRET` 完全一致**，不一致表现为登录后所有写请求被签名校验拒绝。
3. **构建**：构建环境需具备 docker CLI 与 daemon（托管构建环境无 daemon 时，改用自托管构建机或 kaniko 类无 daemon 构建工具），命令：

```bash
set -e

# 构建镜像：latest 供 compose 引用，编号 tag 供服务器侧回滚定位
docker build -t apphub:latest -t "apphub:${BUILD_NUMBER:-local}" \
  --build-arg VITE_SIGN_SECRET="$VITE_SIGN_SECRET" .

# 导出压缩 tar 作为构建产物（同时保留两个 tag）
docker save apphub:latest "apphub:${BUILD_NUMBER:-local}" | gzip > apphub-image.tar.gz
```

构建产物勾选上报：`apphub-image.tar.gz` 与 `deploy/` 目录（后者供首次初始化与部署脚本使用）。

### 5.3 主机部署阶段

1. 主机组中添加 Ubuntu 服务器（阿里云 ECS 可自动安装 Agent，其他机器按云效指引手动安装 Agent 或配置 SSH 授权）。
2. 制品选择上一阶段的构建产物，部署脚本执行：

```bash
sh deploy/deploy.sh
```

部署脚本逻辑：校验 `/opt/apphub/server.env` 与 `docker-compose.yml` 就位 → `docker load -i apphub-image.tar.gz` → `docker compose up -d` → 清理悬空层（保留带 tag 的历史镜像供回滚）→ 输出容器状态。

## 6. 日常发布与回滚

- **发布**：push 到 `main` 即全链路自动执行；进度与日志在云效流水线页查看。
- **验证**：部署后访问全局 nginx 域名的 `/api/health` 应返回健康信息；服务器上 `docker ps` 应见 `apphub` 容器 `(healthy)`。
- **回滚（快速）**：服务器上历史镜像以流水线编号为 tag 保留，执行：
  ```bash
  docker tag apphub:<历史编号> apphub:latest
  docker compose -f /opt/apphub/docker-compose.yml up -d
  ```
- **回滚（重建）**：重发历史构建产物重新执行部署阶段（CI 产物库保留历史版本时），或 revert 提交后重新触发流水线，适合历史镜像已被清理的场景。

## 7. 配置参考（server.env）

「必改」：✅ 无条件必配；△ 条件必配（按业务就绪情况）；— 可选。

| 变量 | 必改 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | — | 固定 `production` |
| `PORT` | — | 容器内 NestJS 端口，固定 `3000`（镜像内 nginx 按此转发） |
| `DB_HOST` / `DB_PORT` / `DB_USERNAME` / `DB_PASSWORD` / `DB_DATABASE` | ✅ | 外置 PostgreSQL 连接信息；同机部署 `DB_HOST=host.docker.internal`，独立数据库填内网 IP |
| `DB_SYNC` | — | 保持 `false`：生产强制关闭，建表与升级由启动迁移执行（ADR-005） |
| `JWT_SECRET` | ✅ | 长随机串；沿用开发默认值会启动失败（fail-fast） |
| `MEMBER_JWT_SECRET` | ✅ | member 域（终端用户令牌）独立密钥；沿用开发默认值同样启动失败 |
| `MEMBER_ACCESS_EXPIRES_HOURS` / `MEMBER_REFRESH_EXPIRES_DAYS` | — | 终端令牌时效，默认 8 小时 / 30 天 |
| `USER_INIT_PASSWORD` | ✅ | 种子账号 admin 的初始口令 |
| `SIGNATURE_ENABLED` / `SIGNATURE_SECRET` | ✅ | 签名开关与密钥；开启时密钥须与前端构建注入的 `VITE_SIGN_SECRET` 一致 |
| `SIGNATURE_EXPIRE_MS` | — | 签名时间窗，默认 300000（5 分钟） |
| `RATE_LIMIT_LIMIT` / `RATE_LIMIT_WINDOW_MS` | — | 开放 API 限流（AppKey + IP 滑动窗口），默认 60 次 / 60 秒 |
| `ALI_ACCESS_KEY_ID` / `ALI_ACCESS_KEY_SECRET` | △ | 全局阿里云 AK（整个应用唯一一组）：OSS 与短信通道共用同一 RAM 子账号（同时授 OSS 与 `dysmsapi:SendSms` 权限） |
| `OSS_REGION` / `OSS_BUCKET` | △ | 安装包分发（appcenter），AK 经上方 `ALI_ACCESS_KEY_*`；不配不影响启动，上传相关接口返回「存储未配置」；桶 CORS 须放行管理后台 Origin（PUT/POST/GET + ETag 暴露头） |
| `STS_ROLE_ARN` | △ | STS 直传凭证签发的 RAM 角色（策略授 `packages/*` 与 `icons/*` PutObject——安装包与应用图标）；缺失时仅上传凭证接口拒绝 |
| `SMS_SIGN_NAME` / `SMS_TEMPLATE_CODE` | △ | 阿里云短信验证码通道（AK 经 `ALI_ACCESS_KEY_*`）；生产缺配启动失败（`ALLOW_CHANNEL_FALLBACK=true` 时降级 log 通道）；当前模板 `SMS_512656603`（签名「张家港智汇冰芯」） |
| `MAIL_HOST` / `MAIL_PORT` / `MAIL_USER` / `MAIL_PASS` / `MAIL_FROM` | △ | SMTP 邮件验证码通道；fail-fast 与降级规则同短信 |
| `WECHAT_PAY_APP_ID` / `WECHAT_PAY_MCH_ID` / `WECHAT_PAY_CERT_SERIAL` / `WECHAT_PAY_PRIVATE_KEY_PATH` / `WECHAT_PAY_APIV3_KEY` | △ | 微信 Native 渠道（五项齐备启用该渠道）；PEM 放 `/opt/apphub/pay-certs/`，路径直接填服务器路径（compose 挂载为容器内同路径） |
| `WECHAT_PAY_PUBLIC_KEY_SERIAL` / `WECHAT_PAY_PUBLIC_KEY_PATH` | — | 微信公钥模式（2024 后新商户）；不配则平台证书模式自动拉取 |
| `ALIPAY_APP_ID` / `ALIPAY_PRIVATE_KEY_PATH` / `ALIPAY_PUBLIC_KEY_PATH` | △ | 支付宝当面付渠道（三项齐备启用）；PEM 路径规则同上 |
| `ALIPAY_GATEWAY` | — | 默认正式网关，沙箱联调改沙箱网关 |
| `PAY_PUBLIC_BASE_URL` | △ | 回调公网地址：填站点完整域名（`https://…`）；配置后预下单显式传 notify_url |
| `ALLOW_CHANNEL_FALLBACK` | △ | **通道降级开关（上线批次 DEP-5）**：默认 `false` 维持生产 fail-fast；资质报备未齐的窗口期置 `true`——短信 / 邮件降级 log 通道、支付渠道不注册（在线下单报 005200005，线下收款备案不受影响）。仅豁免「全部未配置」，部分填写仍启动失败；Mock 支付永不进生产。资质就绪后配真实通道并改回 `false` |
| `SWAGGER_ENABLED` | — | 生产建议 `false`（关闭 `/api-docs`） |

修改 `server.env` 后需重启容器生效：`docker compose -f /opt/apphub/docker-compose.yml up -d`（重建容器读取新配置）。

## 8. 常见问题

| 现象 | 排查 |
| --- | --- |
| 容器反复重启，日志含数据库等待超时 | `server.env` 的 `DB_*` 配置有误或数据库未放行容器访问；同机数据库确认 PostgreSQL 监听地址包含 docker 网桥（`listen_addresses` 与 `pg_hba.conf`） |
| 容器反复重启，日志含短信 / 邮件 / 支付通道 fail-fast | 资质窗口期在 `server.env` 置 `ALLOW_CHANNEL_FALLBACK=true` 降级上线；或补全对应通道配置（部分填写属配置错误，开关不豁免） |
| 登录成功但所有写请求失败 | 前端 `VITE_SIGN_SECRET`（构建期注入）与后端 `SIGNATURE_SECRET`（运行期注入）不一致，两边对齐后重新构建 / 重启 |
| 页面白屏 / 静态资源 404 | 全局 nginx 与镜像内 nginx 均约定部署在域名根路径（`/`），子路径部署需调整 Vite `base` 与两份 nginx 配置 |
| 上传文件 413 | 两级 nginx 均已设 `client_max_body_size 20m`，超限自行上调（`deploy/nginx-gateway.conf.example` 与 `docker/nginx.conf` 同步改） |
| 发版后页面未更新 | 浏览器缓存了旧 `index.html`；镜像内 nginx 已对该文件设 `no-cache`，强制刷新一次即可 |

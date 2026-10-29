<div align="center">

# apphub · 应用管理平台

**多应用更新分发 · 终端用户统一认证 · 订阅与计费**

NestJS 11 · TypeORM · PostgreSQL ｜ Vue 3 · Pinia · Element Plus

[快速开始](#快速开始) · [核心能力](#核心能力) · [开放-api](#开放-api) · [部署](#部署) · [开发文档](docs/) · [许可证](#许可证)

</div>

---

## 项目简介

apphub 是面向**自研应用矩阵**的一体化管理后台：把多个客户端应用（Electron / Tauri 桌面端、Android / iOS、Web）共用的三件事收拢到一套服务里——

- **更新分发**：版本登记、安装包托管与更新检测。内置自研 JSON 协议，并直接兼容 `electron-updater`（`latest*.yml`）与 `tauri-plugin-updater`（manifest）两套生态的标准拉取方式，客户端几乎不用贴合私有协议改代码
- **统一认证**：终端用户一次注册，即可在各应用间通用；五种凭证（密码 / 手机验证码 / 邮箱验证码 / 微信扫码 / 支付宝扫码）、应用级 HMAC 签名、在线校验（introspect）
- **订阅计费**：计划与订单、订阅实例顺延，微信 Native 扫码与支付宝当面付在线支付，外加线下收款备案通道

配套的管理后台提供应用 / 通道 / 版本 / 包、会员、订阅、系统管理全套页面，并支持**应用管理员**按应用维度划定数据范围。工程底座延续企业级全栈框架的 vibe coding first 范式：规则目录（`rules/`）+ 文档先行 + ESLint 保存即修复 + lefthook 提交门禁 + `pnpm check` 一键自检 + Playwright 全链路验收。

## 核心能力

| 域 | 能力 | 关键设计 |
| --- | --- | --- |
| 应用与版本（appcenter） | 应用注册与 AppSecret 轮换、多通道、版本状态机（草稿 → 已发布 → 已下线）、平台 × 架构安装包、应用图标 | 私有 OSS + STS 直传（浏览器直传，后端只签发临时凭证并校验存在性 / 体积）；包对象键由后端生成，下载签发 2h 签名 URL 并按原始文件名落盘 |
| 更新检测（开放 API） | 自研协议 + electron / tauri 适配端点 | GET 端点豁免签名；electron 清单按平台固定映射 arch；未识别 target 按「无更新」处理（204） |
| 统一认证（member） | 五种凭证、登录即注册、凭证绑定合并、防爆破锁定 | 双令牌（8h access + 30d 刷新令牌 SHA-256 落库轮换抢占）；失败连续 5 次锁定 15 分钟；管理端可解绑 / 重置密码 / 启停 |
| 订阅与支付（subscription） | 计划（月度 / 季度 / 年度 / 永久）、订单、订阅实例 | 周期按「N 日历月钳制月末日 + N×30 天保底」计算，永久档用哨兵日期；单实例顺延由订单快照驱动；三层兜底（回调 / 轮询顺带查单 / 每小时逐单核对） |
| 权限与数据范围 | RBAC 三级权限（菜单 / 路由 / 按钮）+ 应用级数据范围 | `data_scope`（全部 / 按应用）+ 账户级应用授权，`app_admin` 预置角色；越权统一 403，范围判定 fail-closed |
| 系统管理 | 认证 / 用户 / 角色 / 部门 / 岗位 / 字典 / 参数 / 操作日志 / 登录日志 | 全局 Guard 链 **签名 → 认证 → 权限**；权限点为多模块聚合注册表，启动期 fail-fast |

## 技术栈

| 端 | 技术 | 说明 |
| --- | --- | --- |
| 后端 | Node.js 20+ / NestJS 11 | 模块化企业级后端框架 |
| ORM / 数据库 | TypeORM / PostgreSQL（默认） | 实体为 schema 唯一事实源，迁移是唯一建表通道；仅承诺主流数据库 |
| 前端 | Vue 3 / Vite / TypeScript | 组合式 API，主布局 + 多标签页 |
| 状态管理 | Pinia | 外观 / 多标签 / 认证按域拆分 |
| UI 组件库 | Element Plus + vxe-table | 表格场景统一走 `ApphubTable` 封装（列宽 / 列序拖拽 + 按路由持久化） |
| 存储 | 阿里云 OSS（私有桶） | STS 直传安装包与应用图标，展示走签名 URL |
| 通知通道 | 阿里云短信（dysmsapi V2）/ SMTP | 未配置时非生产降级打码日志，生产缺配置启动 fail-fast |
| 支付通道 | 微信支付 Native / 支付宝当面付 | 渠道适配层统一接口，非生产降级 Mock 渠道 |
| 包管理 | pnpm workspace | 单仓库多包管理 |

## 仓库结构

```text
apphub/
├── server/                   # 后端服务（NestJS 11 + TypeORM + PostgreSQL）
│   ├── src/
│   │   ├── common/           # 横切设施：拦截器 / 过滤器 / 守卫 / 中间件 / 签名 / 限流 / 审计 / 错误码
│   │   ├── config/           # 环境配置工厂（业务代码不直接读 process.env）
│   │   ├── migrations/       # 数据库迁移（唯一建表通道，含种子数据）
│   │   ├── modules/
│   │   │   ├── system/       # 认证授权与系统管理九域
│   │   │   ├── appcenter/    # 应用 / 通道 / 版本 / 包 / 开放更新检测 / 发版技能分发
│   │   │   ├── member/       # 终端会员 / 凭证 / 认证（含验证码与扫码）/ 令牌
│   │   │   ├── subscription/ # 订阅计划 / 订单 / 订阅实例 / 在线支付渠道
│   │   │   └── demo/         # 样板业务模块（新模块照此接入）
│   │   ├── app.module.ts     # 根模块：配置 + 数据库 + 全局 Guard 链装配
│   │   └── main.ts           # 应用入口：全局管道 / Swagger / 启动
│   ├── test/                 # 后端 API e2e（supertest，DataSource 打桩，无需真实库）
│   └── .env.example          # 环境变量模板
├── web/                      # 管理后台（Vue 3 + Pinia + Element Plus）
│   └── src/
│       ├── api/              # axios 实例与接口封装（token 注入 / 401 接管 / 签名）
│       ├── components/       # 通用组件（ApphubTable 表格封装 / RowActions 操作列收纳 / 字典与品牌组件）
│       ├── layouts/          # 主布局（顶栏 / 侧栏 / 标签栏 / 内容卡片）
│       ├── framework/        # 组件槽位注册表（业务覆盖布局组件）
│       ├── router/           # 路由按域拆分 + 登录守卫
│       ├── stores/           # Pinia 状态（外观 / 多标签 / 认证 / 字典）
│       └── views/            # 页面：系统管理 / 应用中心 / 会员管理 / 订阅管理 / 个人中心
├── e2e/                      # 浏览器端到端测试（Playwright，页面 → Vite 代理 → 后端全链路）
│   └── tests/                # 首页 / 登录链路 / 布局与多标签 / 系统管理 / 应用中心 / 会员 / 订阅 / 数据范围 / 后端连通性
├── deploy/                   # 部署资产：发布包打包与部署脚本、server.env 模板、nginx 站点与网关示例、Docker Compose
├── skills/apphub-release/    # 发版技能（供应用侧 AI agent 安装，打包 → 上传 → 登记 → 发布 → 验证）
├── docs/                     # 开发文档（架构 / 指南 / 前端 / 应用管理平台 / 决策 ADR / 接入手册）
├── rules/                    # AI 工作规则（base.md 最高优先级）
├── scripts/                  # 工程化脚本（构建发布、提交信息校验等）
├── Dockerfile                # 备选部署方案：单镜像多阶段构建
└── pnpm-workspace.yaml       # monorepo 工作区配置
```

## 环境要求

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 20 | 前后端构建运行基础 |
| pnpm | ≥ 9 | 包管理器（`npm i -g pnpm`） |
| PostgreSQL | 16+ | 数据库独立部署，连接信息在 `server/.env` 配置 |

OSS、短信、邮件、支付为**按需配置**：本地开发未配置时，上传类接口不可用、验证码走打码日志通道、支付走 Mock 渠道，其余功能不受影响。

## 快速开始

```bash
# 1. 克隆仓库
git clone <仓库地址> && cd apphub

# 2. 安装依赖（同时安装 Git 提交钩子）
pnpm install

# 3. 准备后端环境变量（按本机 PostgreSQL 实际连接信息修改）
cp server/.env.example server/.env    # Windows: copy server\.env.example server\.env

# 4. 执行数据库迁移（唯一建表通道：建表 + 种子数据与初始账号）
pnpm --filter server migration:run

# 5. 并行启动前后端开发服务
pnpm dev
```

### 访问入口

| 入口 | 地址 |
| --- | --- |
| 管理后台 | http://localhost:5180 |
| 后端 API | http://localhost:3000/api |
| 健康检查 | http://localhost:3000/api/health |
| Swagger 接口文档 | http://localhost:3000/api-docs |

> 内置管理员账号 **admin / admin123**（种子迁移创建，初始口令可由参数 `system.user.init-password` → 环境变量 → 默认值三级兜底；仅见于开发者文档，登录页不展示）。**对外部署后请第一时间在个人中心修改初始口令。**

## 配置说明

后端配置全部经环境变量注入（模板 [server/.env.example](server/.env.example)），在 `server/src/config/configuration.ts` 汇总后由 `ConfigService` 读取：

| 分组 | 变量 | 说明 |
| --- | --- | --- |
| 运行 | `PORT` / `SWAGGER_ENABLED` | 服务端口（默认 3000）、接口文档开关 |
| 数据库 | `DB_*` / `DB_SYNC` | 连接信息；`DB_SYNC` 仅供开发兜底，**生产强制关闭并告警**，建表与升级一律走迁移 |
| 签名 | `SIGNATURE_ENABLED` / `SIGNATURE_SECRET` / `SIGNATURE_EXPIRE_MS` | 管理端请求签名（Guard 链首环）与时间窗 |
| 认证 | `JWT_SECRET` / `JWT_EXPIRES` / `MEMBER_JWT_SECRET` / `MEMBER_ACCESS_EXPIRES_HOURS` / `MEMBER_REFRESH_EXPIRES_DAYS` | 管理端与终端会员两套独立密钥；生产缺省值启动 fail-fast |
| 对象存储 | `ALI_ACCESS_KEY_*` / `OSS_REGION` / `OSS_BUCKET` / `STS_ROLE_ARN` | 私有桶 + STS 直传；OSS 与短信共用同一 RAM 子账号 |
| 短信 / 邮件 | `SMS_SIGN_NAME` / `SMS_TEMPLATE_CODE`；`MAIL_HOST` / `MAIL_PORT` / `MAIL_USER` / `MAIL_PASS` / `MAIL_FROM` | 验证码通道；生产缺配置启动 fail-fast，非生产降级为打码日志 |
| 支付 | `WECHAT_PAY_*` / `ALIPAY_*` / `PAY_PUBLIC_BASE_URL` | 证书一律填文件路径（生产挂载到 `/opt/apphub/pay-certs/`） |
| 降级开关 | `ALLOW_CHANNEL_FALLBACK` | 默认 `false`（维持 fail-fast）；置 `true` 豁免「通道全未配置」——短信邮件降 log、支付渠道不注册 |

前端以 `VITE_` 前缀声明（`.env.development` / `.env.production`），仅 `VITE_API_BASE_URL` 与请求签名密钥两项。

## 常用命令

在仓库根目录执行（必须使用 pnpm）：

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装全部依赖（并自动安装 Git 提交钩子） |
| `pnpm dev` | 并行启动前后端 |
| `pnpm dev:server` / `pnpm dev:web` | 单独启动后端（watch）/ 前端 |
| `pnpm build` | 构建前后端产物 |
| `pnpm check` | **一键自检**：lint + 类型检查 + 前后端单元测试 + 后端 API e2e（完成的定义） |
| `pnpm test` | 前后端单元测试（server Jest / web Vitest） |
| `pnpm test:e2e` | 后端 API e2e（无需真实数据库） |
| `pnpm test:e2e:web` | 浏览器端到端测试（Playwright，自动拉起前后端；无数据库环境自动回退为仅前端，全链路用例跳过） |
| `pnpm --filter server migration:run` | 执行数据库迁移（另有 `migration:generate -- src/migrations/<名称>` 生成、`migration:revert` 回退） |
| `pnpm lint` / `pnpm type-check` | ESLint 检查并自动修复 / 前端 vue-tsc 类型检查 |

运行单个测试文件：`pnpm --filter server test -- app.controller`

## 开放 API

面向**客户端应用**的接口统一在 `/api/open/**`、`/api/update/**`、`/api/skill/**` 下，与应用管理后台的 `/api/appcenter/**` 等管理端接口分离。鉴权按端点分别约定：

| 端点组 | 鉴权 | 用途 |
| --- | --- | --- |
| `/api/open/app/version/check` | AppKey + HMAC 签名 | 自研协议的更新检测 |
| `/api/update/:appKey/:channelCode/electron/latest*.yml` | 无需签名（GET 只读） | `electron-updater` 标准清单 |
| `/api/update/:appKey/:channelCode/tauri/:target/:currentVersion` | 无需签名 | `tauri-plugin-updater` 清单 |
| `/api/open/member/auth/*`（register / login / code/send / refresh / logout / bind） | AppKey + HMAC 签名 | 终端用户注册、登录、发码、刷新与绑定 |
| `/api/open/member/token/introspect` | AppKey + HMAC 签名 | access token 在线校验（含订阅状态） |
| `/api/open/subscription/*`（plans / order/create / order/query） | AppKey + HMAC 签名 + 用户态 | 在售计划、下单与订单轮询 |
| `/api/pay/callback/wechat` / `/api/pay/callback/alipay` | 渠道侧验签 | 支付异步通知（裸响应契约） |
| `/api/skill/apphub-release/*` | 公开 | 发版技能的自主更新与冷启动安装 |

应用级签名方案：`X-App-Key` 定位应用，用其 AppSecret 按 `app` 方案签名；AppKey 维度另有 IP 限流。接入步骤见 [更新检测接入手册](docs/接入手册/更新检测接入手册.md)、[会员认证接入手册](docs/接入手册/会员认证接入手册.md)、[订阅支付接入手册](docs/接入手册/订阅支付接入手册.md)。

## 客户端侧接入

1. **更新检测**：在应用中心注册应用（得到 AppKey / AppSecret）、建通道、发布版本与安装包，客户端按上表端点接入
2. **发版自动化**：把 [skills/apphub-release](skills/apphub-release/SKILL.md) 交给应用开发的 AI agent 安装，即可「打包 → 直传 OSS → 登记 → 发布 → 验证」全流程闭环，并支持已发布版本补包 / 换包 / 撤包；安装方式见 [技能安装与更新](docs/接入手册/技能安装与更新.md)
3. **认证与订阅**：按接入手册接入登录与 introspect，订阅状态由 introspect 直接返回，客户端不必自行维护

## 部署

生产部署主方案为 **tar.gz 发布包直部署**（[ADR-101](docs/决策/ADR-101-部署主方案切换为发布包直部署.md)）：`/opt/apphub` 下由 **pm2** 常驻后端进程、全局 **nginx** 提供静态站点与反向代理，`deploy/release.sh` 完成「解包 → 覆盖 → 迁移 → 重启 → 健康探测」，构建与主机部署由云效流水线触发（推送 `release/*` 分支即发布）。

- 完整步骤（服务器初始化 / 环境变量 / 站点配置 / 回滚）：[发布包打包与部署指南](docs/指南/发布包打包与部署指南.md)
- 备选方案（单镜像 node + nginx）：[Docker 打包与部署指南](docs/指南/Docker打包与部署指南.md)，两方案共用同一份 `server.env`
- 外部依赖的开通与配置项申请：[平台账号与配置申请指南](docs/指南/平台账号与配置申请指南.md)
- pm2 注意：修改 `server.env` 后必须 `pm2 restart apphub --update-env`（`release.sh` 已内置），首次部署后执行 `pm2 save` 固化开机自启

## 开发指南

### 新增业务模块

后端模块按领域放 `server/src/modules/<领域>/`，可用 `pnpm --filter server exec nest g resource modules/<领域>` 生成骨架，然后**照 `modules/demo` 样板逐步接入**：实体与迁移、错误码分段、权限点注册、审计与操作日志、接口与前端页面。完整八步清单见 [新模块接入指南](docs/指南/新模块接入指南.md)。

**建表一律走迁移**（`DB_SYNC` 默认关闭）：实体变更后 `migration:generate` 生成迁移，`migration:run` 落库；带条件索引等 generate 检测盲区须手写迁移。

### 新增前端页面

页面放 `web/src/views/`（按域建目录），路由在 `web/src/router/modules/` 按域拆分注册（**route name 一律 PascalCase**，是 keep-alive 缓存键契约）。侧栏菜单由布局子路由树按权限过滤生成；接口级权限用路由 `meta.permission`，按钮级用 `v-hasPermi`。列表表格一律用 `ApphubTable`，业务组件只消费 `--apphub-*` 设计 token、不硬编码色值。

### VS Code 一键调试

内置 `.vscode/launch.json`，按 **F5** 可选「仅前端 / 仅后端 / 前后端同步」三个配置；同步调试时浏览器会等后端 3000 端口就绪后再打开。停止调试即终止相关进程，不留后台任务。命令行等价命令：`pnpm --filter server run dev:debug`（监听 9229）。

### 提交信息与门禁

提交信息格式 `【动作】模块 - 内容概述`（动作：新增 / 修改 / 修复 / 移除 / 重构 / 优化 等）。`pnpm install` 时由 lefthook 安装钩子：pre-commit 对暂存代码文件自动 ESLint 修复并重新暂存；commit-msg 校验格式（合并类提交自动放行）。

## 测试与验证基线

- **单元测试**：server Jest / web Vitest，与源码同目录（`*.spec.ts`），按风险分级取舍（横切设施要求高分支覆盖）
- **后端 API e2e**：`server/test/`，supertest + DataSource 打桩，验证装配与 HTTP 语义
- **浏览器全链路 e2e**：`e2e/tests/`，Playwright 从页面点到后端并断言落库效果，覆盖登录、布局、系统管理、应用中心、会员、订阅、数据范围

当前基线：`pnpm check` 全绿（server 单测 521 + 后端 e2e 128、web 单测 120），浏览器 e2e 35 用例。改动是否完成以 `pnpm check` 全绿为准。

## 开发文档

文档集中维护在 [docs/](docs/)（索引见 [docs/README.md](docs/README.md)），全部中文撰写，按模块与功能分类：

| 分类 | 文档 |
| --- | --- |
| 架构与规范 | [架构设计](docs/架构设计.md)、[新模块接入指南](docs/指南/新模块接入指南.md)、[权限设计](docs/指南/权限设计.md)、[统一响应与异常处理设计](docs/指南/统一响应与异常处理设计.md)、[请求签名验证设计](docs/指南/请求签名验证设计.md) |
| 业务设计 | [总体设计](docs/应用管理平台/总体设计.md)、[应用与版本管理](docs/应用管理平台/应用与版本管理设计.md)、[应用图标上传](docs/应用管理平台/应用图标上传设计.md)、[统一认证](docs/应用管理平台/统一认证设计.md)、[认证方式扩展](docs/应用管理平台/认证方式扩展设计.md)、[订阅与支付](docs/应用管理平台/订阅与支付设计.md)、[在线支付渠道接入附录](docs/应用管理平台/在线支付渠道接入附录.md)、[应用管理员与数据范围](docs/应用管理平台/应用管理员与数据范围设计.md)、[发版 Skill](docs/应用管理平台/发版Skill设计.md) |
| 前端设计 | [布局与风格](docs/前端/布局与风格设计.md)、[表格组件](docs/前端/表格组件设计.md)、[个人中心](docs/前端/个人中心设计.md)、[品牌与 Logo](docs/前端/品牌与Logo设计.md) |
| 接入与运维 | [接入手册](docs/接入手册/README.md)、[发布包打包与部署](docs/指南/发布包打包与部署指南.md)、[Docker 打包与部署](docs/指南/Docker打包与部署指南.md)、[平台账号与配置申请](docs/指南/平台账号与配置申请指南.md) |
| 决策记录 | [docs/决策/](docs/决策/)（ADR-001~005 与上游同源，ADR-100 起为本仓库自有） |

业务开发遵循**文档先行**：先在 `docs/` 对应目录写设计文档，再写代码；实现偏离设计时先更新文档。

## AI 工作规则

[rules/](rules/) 目录是 AI 辅助开发的规则集，生成代码必须遵循：

- [base.md](rules/base.md) —— 最高优先级：文档先行、完成定义（`pnpm check`）、提交信息规范、代码文件头部注释、MIT 许可
- [code-style.md](rules/code-style.md) —— 无分号、单引号、2 空格缩进、import 分组排序、后端统一 Nest `Logger`，由 ESLint 自动强制
- [testing.md](rules/testing.md) —— 风险驱动的测试分层取舍（何时写 / 写在哪层 / 写到什么程度）
- [branding.md](rules/branding.md) —— 品牌化只在前端 UI 层面，框架代码前缀与注释不替换（含与上游同步时的冲突处理约定）

## 交付状态

| 期 | 内容 | 状态 |
| --- | --- | --- |
| 底座 | 工程化基座、数据层、JWT + RBAC 三级权限、系统管理九域、主布局、样板模块 | ✅ |
| M1 | 应用与版本管理（应用 / 通道 / 版本 / 包、开放更新检测、OSS 直传） | ✅ |
| M2 | 会员统一认证（密码先行、双令牌、应用级签名、introspect、会员管理） | ✅ |
| M3 | 订阅与支付（计划 / 订单 / 订阅实例、线下备案、顺延规则） | ✅ |
| M4 | 认证方式扩展（手机 / 邮箱验证码、微信 / 支付宝扫码） | ✅ |
| M5 | 在线支付（微信 Native + 支付宝当面付，回调 + 轮询 + 每小时兜底） | ✅ |
| M6 | 应用管理员与数据范围（`data_scope` + 账户级应用授权） | ✅ |

当前线上版本 **v1.6.0**。后续方向：真实支付渠道联调验收（待商户资质）、前端按需引入与构建优化、CI 质量门禁。

## 许可证

本项目以 [MIT 许可证](LICENSE)开源，许可证全文见仓库根目录 [LICENSE](LICENSE)。

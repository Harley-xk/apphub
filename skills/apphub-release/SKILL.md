---
name: apphub-release
description: 应用发版助手：向 apphub 应用管理平台发布新版本——自动打包、上传安装包（STS 直传 OSS）、创建/发布/验证版本、维护版本信息（更新说明、强制标记、下线）。当用户要求发版、发布新版本、上传安装包、更新版本信息、下线版本，或首次接入 apphub 平台发版时使用。
---

# apphub 发版助手

面向**应用开发侧**：把「构建产物 → 平台登记 → 发布 → 客户端可见」全流程闭环。设计依据见 apphub 仓库 `docs/应用管理平台/发版Skill设计.md`。

**环境要求**：Node ≥ 18，零第三方依赖。脚本为本 skill 目录下的 `scripts/apphub.mjs`，下文 `node scripts/apphub.mjs` 均指该文件的实际路径。

**职责分工**：你（agent）负责判断类工作（识别框架、读版本号、定位产物、生成更新说明、确认门）；脚本负责精确执行（认证、签名、哈希、直传、API 调用）。脚本不做交互、不猜值——参数一律由你显式传入。

## 0. 首次接入（项目内无 `.apphub-release.json` 时）

1. 向用户收集四项信息：
   - **平台基址** `baseUrl`（形如 `https://api.example.com`，不带 `/api` 后缀）
   - **发版账号**（平台方发放，用户名 + 密码；平台开启签名时另有签名密钥）
   - **appKey**（32 位，`ah_` 开头，向平台方索取）
   - **目标通道** code（默认 `stable`）
2. 识别项目框架（见 §2），据此生成项目根目录 `.apphub-release.json`：

   ```jsonc
   {
     "baseUrl": "https://api.example.com",
     "appKey": "ah_xxxxxxxxxxxxxxxx",
     "channel": "stable",
     "buildCommand": "pnpm electron-builder --win --x64",  // 可选，自定义构建命令
     "platforms": [   // 目标平台产物 glob 映射（由你展开为具体文件）
       { "platform": "windows", "arch": "x64", "artifact": "dist/*Setup*.exe", "blockmap": "dist/*Setup*.exe.blockmap", "sig": "src-tauri/target/release/bundle/**/*.sig" }
     ]
   }
   ```

3. 凭据默认走环境变量 `APPHUB_USERNAME` / `APPHUB_PASSWORD` / `APPHUB_SIGN_SECRET`（CI 友好）；仅当用户明确同意落文件时才写入配置 `credentials` 节，且**必须**同步把 `.apphub-release.json` 加入 `.gitignore`。
4. 运行 `node scripts/apphub.mjs status` 验证：输出应用与通道清单即接入完成。若报 401「签名校验失败」，平台开启了请求签名——补配 `APPHUB_SIGN_SECRET` 后重试。

## 1. 标准发版流程

按序执行，任一步失败按 §4 处置后重试：

1. **读版本号**：electron / 自定义项目读 `package.json` 的 `version`；tauri 项目读 `src-tauri/tauri.conf.json` 的 `version`。格式必须 semver（`MAJOR.MINOR.PATCH`，可选 `-beta.1` 类后缀），不符先让用户修。
2. **定更新说明**：用户已给出则用之；未给出时用 `git log <上一版本 tag>..HEAD --oneline`（无 tag 则最近 10 条）生成草稿，**呈给用户确认或修改**后使用。版本标题默认 `v{version}`。
3. **构建**：构建命令优先级 = 用户本次指定 > 项目脚本（`package.json` scripts，如 `build:win` / `tauri`）> 框架惯例（§2）> 配置 `buildCommand`。构建失败如实报告，不带病继续。
4. **定位产物**：按 §2 框架适配定位安装包及配套产物（blockmap / .sig）。glob 展开结果多于一个时列出候选让用户选择；一个都没有视为构建失败。
5. **建草稿版本**：`node scripts/apphub.mjs create-version --version {版本} --title {标题} --notes {说明}`（强制更新加 `--force`）。同版本已有草稿会自动复用，属正常续作场景。
6. **逐平台上传**：对每个平台执行
   `node scripts/apphub.mjs upload --version {版本} --platform {平台} --arch {架构} --file {安装包路径} [--blockmap {blockmap}] [--sig-file {签名文件}]`
   - electron 项目建议传 `--blockmap`（客户端获得差分更新）
   - tauri 项目必须传 `--sig-file`（发布前置校验强制 minisign 签名）
7. **确认门（红线）**：发布即客户端可见。向用户呈现发布摘要——版本号 / 通道 / 各平台包与大小 / 更新说明 / 强制标记——明确同意后执行
   `node scripts/apphub.mjs publish --version {版本}`。
   **例外**：用户已明示「全自动 / 不要确认 / CI 模式」时跳过此门。
8. **验证**：`node scripts/apphub.mjs verify --expect {版本} --platform {平台} [--arch {架构}] [--current {任一旧版本}]`，通过即闭环；失败按 §4 排查。
9. **汇报**：发布完成后汇总版本 / 通道 / 包清单 / 验证结果 / 下载链路提示（客户端经更新检测自动获取）。

## 2. 框架适配——产物定位

### 2.1 electron（electron-builder）

- 构建命令惯例：`electron-builder --win --x64` / `--mac --arm64` / `--linux`（或项目 scripts）
- 产物在 `dist/`（或 electron-builder.yml 配置目录）：

  | platform | arch | 安装包 | 同名 blockmap |
  | --- | --- | --- | --- |
  | `windows` | `x64` | `*.exe`（nsis） | `*.exe.blockmap` |
  | `macos` | `universal` / `x64` / `arm64` | `*.dmg` | `*.dmg.blockmap` |
  | `linux` | `x64` | `*.AppImage` | `*.AppImage.blockmap` |

- **sha512 对照（防产物错位，必做）**：脚本会自动计算 sha512；你同时读 `dist/latest.yml`（或 `latest-mac.yml`）中同名 `files[].sha512` 与脚本输出对照——不一致说明定位错文件或产物过期，**停止发版**并报告。
- `framework=electron` 的包必须登记 sha512（脚本必算必传，天然满足）。

### 2.2 tauri（tauri build）

- 构建前置：环境变量 `TAURI_SIGNING_PRIVATE_KEY`（及其密码变量）必须已配置，否则不产出 `.sig`
- 构建：`pnpm tauri build`；产物在 `src-tauri/target/release/bundle/`：`nsis/*.exe` + `.sig`、`msi/*.msi` + `.sig`、`macos/*.app.tar.gz` + `.sig`、`deb/*.deb` + `.sig`
- `--sig-file` 取同名 `.sig` 文件；**找不到 `.sig` 时停止**，提示用户配置签名私钥后重新构建（framework=tauri 发布强制校验 minisign）
- tauri 无 blockmap 概念，不传 `--blockmap`

### 2.3 自定义 / 其他

- 构建走配置 `buildCommand`；产物按 `platforms[].artifact` glob 定位，框架产物字段按需（平台未归类框架时不强制 sha512 / minisign）

### 2.4 特殊平台边界

- `web`：无包记录，仅建版本（发版止于 create-version，直接确认后 publish）
- `ios`：仅元信息登记且不走直传（当前脚本未覆盖，用平台管理后台操作）

## 3. 版本维护

- **改更新说明 / 强制标记 / 标题**：`node scripts/apphub.mjs update-version --version {版本} [--notes {新说明}] [--force true|false] [--title {新标题}]`（draft 全字段可改；已发布版本仅说明与强制标记可改，服务端校验兜底）
- **下线版本**：`node scripts/apphub.mjs offline --version {版本}`——终态操作，执行前须用户确认；下线后客户端回退看到次新已发布版本
- **撤回草稿**：`node scripts/apphub.mjs delete-version --version {版本}`（连带清理已传包与 OSS 对象）
- **换包重传**（draft 期产物传错）：`remove-package --version {版本} --platform {平台} [--arch {架构}]` 删旧包后重新 `upload`

## 4. 错误处置

| 现象 / 错误码 | 含义 | 你的动作 |
| --- | --- | --- |
| 401 签名校验失败 | 签名密钥缺失或错误 | 平台开启签名时必须配置 `APPHUB_SIGN_SECRET`；确认后重试 |
| 401 且重登仍失败 | 账号或权限问题 | 核对账号；联系平台方确认 appcenter 权限 |
| `300300002` | 版本号非 semver | 修正版本号（MAJOR.MINOR.PATCH） |
| `300300003` | 通道内版本号重复 | 已有草稿会自动复用；已发布则递增版本号重走流程 |
| `300300004` | 状态机不允许 | draft 全改 / published 仅说明与强制标记 / offline 终态，按状态分流操作 |
| `300300005` | 发布校验失败（无可用包） | 至少完成一个平台（非 web）的 upload 再发布 |
| `300400001` | STS 签发失败 | OSS / STS 平台侧配置问题，报告用户联系平台方 |
| `300400002` | 平台 / 架构槽位重复 | 确认产物无误后 remove-package 删旧重传 |
| `300400003` | 框架产物缺失 | electron：核对 sha512 对照环节；tauri：核对 `.sig` 是否产出 |
| `300400004` | 包对象不存在 | 上传未完成即登记；直接重试 upload |
| OSS `AccessDenied` | 直传被拒 | 凭证过期（重试会重新签发）或对象键不符；持续失败联系平台方 |
| verify 失败 hasUpdate=false | 发布未生效 / 应用或通道停用 | 核对版本状态与通道状态后重验 |

## 5. 红线

1. **publish 与 offline 前必须获用户确认**（发布即客户端可见、下线即终态）；仅当用户明示全自动时跳过
2. **凭据不回显、不入库**：日志与汇报中不得出现密码 / 签名密钥；含 credentials 的配置文件必须已在 `.gitignore`
3. **上传仅作用于 draft 版本**：服务端状态机兜底，报错即核对版本状态，勿绕行
4. **产物哈希对照不一致即停止**：宁可中断发版，不登记错位产物

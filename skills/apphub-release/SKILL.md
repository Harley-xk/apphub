---
name: apphub-release
description: 应用发版助手：向 apphub 应用管理平台发布新版本——自动打包、上传安装包（STS 直传 OSS）、创建/发布/验证版本、维护版本信息（更新说明、强制标记、下线），以及已发布版本补包 / 换包 / 撤回平台包；支持从平台自检并更新技能本体。当用户要求发版、发布新版本、上传安装包、补传平台包、替换已发布包、更新版本信息、下线版本、检查/更新发版技能，或首次接入 apphub 平台发版时使用。
---

# apphub 发版助手

面向**应用开发侧**：把「构建产物 → 平台登记 → 发布 → 客户端可见」全流程闭环。设计依据见 apphub 仓库 `docs/应用管理平台/发版Skill设计.md`。

**环境要求**：Node ≥ 18，零第三方依赖。脚本为本 skill 目录下的 `scripts/apphub.mjs`，下文 `node scripts/apphub.mjs` 均指该文件的实际路径。

**职责分工**：你（agent）负责判断类工作（识别框架、读版本号、定位产物、生成更新说明、确认门）；脚本负责精确执行（认证、签名、哈希、直传、API 调用）。脚本不做交互、不猜值——参数一律由你显式传入。

## 0. 首次接入（项目内无 `.apphub-release.json` 时）

1. 向用户收集四项信息：
   - **平台基址** `baseUrl`（apphub 线上环境为 `https://appcenter.witice.top`，不带 `/api` 后缀；私有化部署填平台方提供的地址）
   - **发版账号**（平台方发放，用户名 + 密码；平台开启签名时另有签名密钥）
   - **appKey**（32 位，`ah_` 开头，向平台方索取）
   - **目标通道** code（默认 `stable`）
2. 识别项目框架（见 §2），据此生成项目根目录 `.apphub-release.json`：

   ```jsonc
   {
     "baseUrl": "https://appcenter.witice.top",
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

按序执行，任一步失败按 §5 处置后重试：

0. **技能自检（建议每次执行）**：`node scripts/apphub.mjs self-update --check`。有新版本按 §4 更新后再继续；自检失败仅告警，不阻断发版。
1. **读版本号**：electron / 自定义项目读 `package.json` 的 `version`；tauri 项目读 `src-tauri/tauri.conf.json` 的 `version`。格式必须 semver（`MAJOR.MINOR.PATCH`，可选 `-beta.1` 类后缀），不符先让用户修。
2. **定更新说明**：用户已给出则用之；未给出时用 `git log <上一版本 tag>..HEAD --oneline`（无 tag 则最近 10 条）生成草稿，**呈给用户确认或修改**后使用。版本标题默认 `v{version}`。
3. **构建**：构建命令优先级 = 用户本次指定 > 项目脚本（`package.json` scripts，如 `build:win` / `tauri`）> 框架惯例（§2）> 配置 `buildCommand`。构建失败如实报告，不带病继续。
4. **定位产物**：按 §2 框架适配定位安装包及配套产物（blockmap / .sig）。glob 展开结果多于一个时列出候选让用户选择；一个都没有视为构建失败。
5. **建草稿版本**：`node scripts/apphub.mjs create-version --version {版本} --title {标题} --notes {说明}`（强制更新加 `--force`）。同版本已有草稿会自动复用，属正常续作场景。
6. **逐平台上传**：对每个平台执行
   `node scripts/apphub.mjs upload --version {版本} --platform {平台} --arch {架构} --file {安装包路径} [--blockmap {blockmap}] [--sig-file {签名文件}]`
   - electron 项目建议传 `--blockmap`（客户端获得差分更新）
   - tauri 项目必须传 `--sig-file`（发布前置校验强制 minisign 签名）
   - 已发布版本的补包 / 换包 / 撤包不重走发布流程，操作见 §3
7. **确认门（红线）**：发布即客户端可见。向用户呈现发布摘要——版本号 / 通道 / 各平台包与大小 / 更新说明 / 强制标记——明确同意后执行
   `node scripts/apphub.mjs publish --version {版本}`。
   **例外**：用户已明示「全自动 / 不要确认 / CI 模式」时跳过此门。
8. **验证**：`node scripts/apphub.mjs verify --expect {版本} --platform {平台} [--arch {架构}] [--current {任一旧版本}]`，通过即闭环；失败按 §5 排查。
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
- **撤回草稿**：`node scripts/apphub.mjs delete-version --version {版本}`（连带清理已传包与 OSS 对象；仅 draft）
- **已发布版本补平台包**（如 Windows 已发、macOS 后补）：直接 `upload --version {版本} --platform {平台} …`。槽位空闲即可上传，**不影响其它平台**；已发布版本登记会强制校验框架产物（electron sha512 / tauri minisign）
- **已发布版本换包**（同平台产物有误）：`upload --version {版本} --platform {平台} [--arch {架构}] --file {新包} --replace`。服务端事务内替换记录并清理旧对象；**版本号不变，已安装客户端不会自动更新**，替换只服务新下载 / 新安装——要修复存量用户必须发新版本，执行前后都要向用户说明
- **撤回已发布平台包**：`remove-package --version {版本} --platform {平台} [--arch {架构}]`——该平台回退到更早的有包版本，若无则新用户拿不到该版本；**执行前须用户确认**
- **草稿期换包**：同样用 `upload --replace`，或 `remove-package` 后重新 `upload`（二选一，推荐 `--replace` 避免空档）

## 4. 技能自更新

skill 本体（`SKILL.md` + `scripts/`）由平台随发布包部署，经公开接口 `{baseUrl}/api/skill/apphub-release` 通过 manifest + 逐文件 sha256 分发，不依赖插件市场、第三方源或额外 nginx 配置。

- **检查**：`node scripts/apphub.mjs self-update --check`——读本地 `VERSION` 与远端 manifest 比对，只提示不改文件；更新源不可达时仅告警（不阻断发版）
- **更新**：`node scripts/apphub.mjs self-update`——下载 → sha256 校验 → 逐个原子替换，失败自动回滚；只维护 `SKILL.md` / `VERSION` / `scripts/`，不触碰应用项目根目录的 `.apphub-release.json`
- **确认门**：检测到新版本时，先向用户说明「当前版本 → 新版本」，获同意后执行更新（用户明示全自动 / CI 模式时可跳过）
- **生效时机（诚实边界）**：`scripts/` 下的 CLI **即时生效**；`SKILL.md` 的变更对**已加载的当前会话**不追溯，下次调用技能或新开会话时生效
- **私有化部署**：`--base-url https://your-apphub.example.com`（或配置文件的 `baseUrl`）；未传时依次读配置文件、回落线上基址
- **CI**：`node scripts/apphub.mjs self-update --yes` 作为发版前置步骤
- **自动检查（可选）**：应用工程可在 `.claude/settings.json` 配 SessionStart hook 执行 `--check`，实现每次会话自动发现更新
- **冷启动（未安装 / 旧版无 self-update）**：只需把 `{baseUrl}/api/skill/apphub-release` 交给用户或 agent，接口直接返回安装说明，按说明用 `install.mjs` 完成安装或更新——不需要平台账号，也不依赖本地已有脚本

## 5. 错误处置

| 现象 / 错误码 | 含义 | 你的动作 |
| --- | --- | --- |
| 401 签名校验失败 | 签名密钥缺失或错误 | 平台开启签名时必须配置 `APPHUB_SIGN_SECRET`；确认后重试 |
| 401 且重登仍失败 | 账号或权限问题 | 核对账号；联系平台方确认 appcenter 权限 |
| `300300002` | 版本号非 semver | 修正版本号（MAJOR.MINOR.PATCH） |
| `300300003` | 通道内版本号重复 | 已有草稿会自动复用；已发布则递增版本号重走流程 |
| `300300004` | 状态机不允许 | draft / published 可维护平台包与说明；offline 终态，按状态分流 |
| `300300005` | 发布校验失败（无可用包） | 至少完成一个平台（非 web）的 upload 再发布 |
| `300400001` | STS 签发失败 | OSS / STS 平台侧配置问题，报告用户联系平台方 |
| `300400002` | 平台 / 架构槽位重复 | 已发布版本换包加 `--replace` 重试；草稿也可 remove-package 后重传 |
| `300400003` | 框架产物缺失 | electron：核对 sha512 对照环节；tauri：核对 `.sig` 是否产出 |
| `300400004` | 包对象不存在 | 上传未完成即登记；直接重试 upload |
| `300400007` | 替换目标不存在 | `--replace` 指向的槽位本无包：去掉 `--replace` 按新增补包重试 |
| OSS `AccessDenied` | 直传被拒 | 凭证过期（重试会重新签发）或对象键不符；持续失败联系平台方 |
| verify 失败 hasUpdate=false | 发布未生效 / 应用或通道停用 | 核对版本状态与通道状态后重验 |
| self-update 更新源不可达 | manifest 拉取失败 / 404 | 核对 `baseUrl` 与平台是否已发布 skill 产物；`--check` 仅告警，发版可继续用本地版本 |
| self-update sha256 不匹配 | 下载损坏或源被替换 | 重试一次；持续失败停止更新并报告，勿手工覆盖文件 |
| self-update 无写权限 | skill 目录只读 | 请用户调整权限，或改用 `--check` 仅检测 |

## 6. 红线

1. **publish、offline、撤回已发布平台包前必须获用户确认**（发布即客户端可见、下线即终态、撤包即改变该平台分发）；仅当用户明示全自动时跳过
2. **凭据不回显、不入库**：日志与汇报中不得出现密码 / 签名密钥；含 credentials 的配置文件必须已在 `.gitignore`
3. **包维护作用于 draft / published，offline 冻结**：offline 报 `300300004` 即停止，重新分发须新建版本，勿绕行
4. **替换 / 撤包不推动已安装客户端**：版本号未变时客户端按 semver 判断无更新；不得把「换包」当作修复存量用户的手段而不告知，修复存量必须发新版本
5. **产物哈希对照不一致即停止**：宁可中断发版，不登记错位产物
6. **自更新只信平台基址**：只从配置的 `baseUrl`（或线上默认基址）拉取 manifest 与文件，不接受第三方 URL、不手工拼装或覆盖 skill 文件；sha256 不匹配即停止

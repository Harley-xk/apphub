#!/usr/bin/env node
/*
 * 作者: Harley-xk
 * 创建: 2026-10-24
 *
 * 描述: apphub-release 技能冷启动安装 / 更新器：不依赖本地已有 skill，按平台 manifest 下载并校验安装（零第三方依赖）
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { parseArgs } from 'node:util'

const DEFAULT_BASE_URL = 'https://appcenter.witice.top'
const SKILL_NAME = 'apphub-release'
const DEFAULT_TARGET = path.join('.claude', 'skills', SKILL_NAME)

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function ok(message) {
  console.log(`✓ ${message}`)
}

function printUsage() {
  console.log('apphub-release 技能安装 / 更新器（冷启动入口，无需本地已安装技能）')
  console.log('')
  console.log('用法：node install.mjs [--check] [--target <技能目录>] [--base-url <平台基址>]')
  console.log('')
  console.log(`  --check       仅检查远端版本与本地差异（未安装 / 有更新 / 已最新）`)
  console.log(`  --target      安装目录（缺省 ${DEFAULT_TARGET}；用户级可用 ~/.claude/skills/${SKILL_NAME}）`)
  console.log(`  --base-url    平台基址（缺省 ${DEFAULT_BASE_URL}；私有化部署填自己的域名）`)
}

let values
try {
  ({ values } = parseArgs({
    options: {
      check: { type: 'boolean' },
      target: { type: 'string' },
      'base-url': { type: 'string' },
      help: { type: 'boolean' },
    },
    strict: true,
    allowPositionals: false,
  }))
}
catch (error) {
  fail(`参数解析失败：${error.message}`)
}

if (values.help) {
  printUsage()
  process.exit(0)
}

/** 通用下载（http/https + 最多 3 次重定向，30s 超时） */
function fetchBuffer(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http
    const request = client.get(url, { headers: { 'User-Agent': `${SKILL_NAME}-installer` } }, (response) => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400 && response.headers.location && redirects > 0) {
        response.resume()
        resolve(fetchBuffer(new URL(response.headers.location, url).href, redirects - 1))
        return
      }
      if (status !== 200) {
        response.resume()
        reject(new Error(`下载失败 HTTP ${status}：${url}`))
        return
      }
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve(Buffer.concat(chunks)))
      response.on('error', reject)
    })
    request.on('error', reject)
    request.setTimeout(30_000, () => request.destroy(new Error('下载超时（30s）')))
  })
}

/** 分发文件路径白名单：只允许 skill 根下 SKILL.md / VERSION / scripts/**，拒绝越权与路径穿越 */
function assertSkillPath(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\\') || path.isAbsolute(rel))
    throw new Error(`manifest 文件路径非法：${String(rel)}`)
  const normalized = path.posix.normalize(rel)
  if (normalized !== rel || normalized.startsWith('..'))
    throw new Error(`manifest 文件路径非法：${rel}`)
  if (!(normalized === 'SKILL.md' || normalized === 'VERSION' || normalized.startsWith('scripts/')))
    throw new Error(`manifest 含不允许分发的文件：${rel}`)
}

/** 简易 semver 比较（与 skill CLI 同语义；无法解析按最小版本处理） */
function compareSemver(a, b) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(value ?? '')
    return match ? { parts: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? '' } : null
  }
  const left = parse(a)
  const right = parse(b)
  if (!left && !right)
    return 0
  if (!left)
    return -1
  if (!right)
    return 1
  for (let index = 0; index < 3; index++) {
    if (left.parts[index] !== right.parts[index])
      return left.parts[index] < right.parts[index] ? -1 : 1
  }
  if (left.pre === right.pre)
    return 0
  if (!left.pre)
    return 1
  if (!right.pre)
    return -1
  return left.pre < right.pre ? -1 : 1
}

async function readLocalVersion(target) {
  try {
    return (await fs.readFile(path.join(target, 'VERSION'), 'utf8')).trim() || null
  }
  catch {
    return null
  }
}

/** 下载并校验全部文件到 staging（调用方负责清理） */
async function downloadToStaging(baseUrl, manifest, staging) {
  await fs.rm(staging, { recursive: true, force: true })
  await fs.mkdir(staging, { recursive: true })
  for (const file of manifest.files) {
    assertSkillPath(file.path)
    if (typeof file.sha256 !== 'string' || file.sha256.length !== 64)
      throw new Error(`manifest 文件缺少合法 sha256：${file.path}`)
    const fileUrl = typeof file.url === 'string'
      ? `${baseUrl}${file.url}`
      : `${baseUrl}/api/skill/${SKILL_NAME}/files/${manifest.version}/${file.path}`
    const content = await fetchBuffer(fileUrl)
    const digest = createHash('sha256').update(content).digest('hex')
    if (digest !== file.sha256)
      throw new Error(`文件校验失败（sha256 不匹配）：${file.path}`)
    const dest = path.join(staging, file.path)
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(dest, content)
  }
}

/** 已存在目标目录时逐个替换；失败回滚 */
async function replaceInto(target, manifest, staging) {
  const applied = []
  try {
    for (const file of manifest.files) {
      const destination = path.join(target, file.path)
      const source = path.join(staging, file.path)
      const backup = path.join(staging, `${file.path}.old`)
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.mkdir(path.dirname(backup), { recursive: true })
      let hadOld = false
      try {
        await fs.rename(destination, backup)
        hadOld = true
      }
      catch {}
      try {
        await fs.rename(source, destination)
      }
      catch (error) {
        if (hadOld)
          await fs.rename(backup, destination).catch(() => {})
        throw error
      }
      applied.push({ destination, backup: hadOld ? backup : null })
    }
  }
  catch (error) {
    for (const item of applied.reverse()) {
      await fs.rm(item.destination, { force: true }).catch(() => {})
      if (item.backup)
        await fs.rename(item.backup, item.destination).catch(() => {})
    }
    throw error
  }
}

async function main() {
  const baseUrl = (values['base-url'] ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const target = path.resolve(values.target ?? DEFAULT_TARGET)
  const checkOnly = Boolean(values.check)
  const manifestUrl = `${baseUrl}/api/skill/${SKILL_NAME}/manifest`

  let manifest
  try {
    manifest = JSON.parse((await fetchBuffer(manifestUrl)).toString('utf8'))
  }
  catch (error) {
    fail(`无法获取技能清单（${manifestUrl}）：${error instanceof Error ? error.message : String(error)}`)
  }
  if (manifest?.name !== SKILL_NAME || typeof manifest.version !== 'string' || !Array.isArray(manifest.files))
    fail('技能清单格式非法（缺少 name / version / files）')

  const local = await readLocalVersion(target)
  if (!local)
    console.log(`本地未安装技能（目标 ${target}），远端版本 ${manifest.version}`)
  else if (compareSemver(local, manifest.version) < 0)
    console.log(`发现技能新版本：${local} → ${manifest.version}`)
  else
    console.log(`技能已是最新：${local}`)

  if (checkOnly) {
    if (!local || compareSemver(local, manifest.version) < 0)
      console.log('  去掉 --check 执行安装 / 更新')
    return
  }

  const staging = `${target}.installing-${process.pid}`
  try {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await downloadToStaging(baseUrl, manifest, staging)
    const exists = await fs.stat(target).then(stat => stat.isDirectory()).catch(() => false)
    if (exists) {
      await replaceInto(target, manifest, staging)
      ok(`技能已更新：${local ?? '未知'} → ${manifest.version}（${target}）`)
    }
    else {
      await fs.rename(staging, target)
      ok(`技能已安装：${manifest.version}（${target}）`)
    }
    console.log('  新会话或下次调用技能时加载最新指令；CLI 可立即使用。')
  }
  catch (error) {
    // fail() 直接退出进程，finally 不会执行，故先清理 staging
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
    fail(`安装 / 更新失败：${error instanceof Error ? error.message : String(error)}`)
  }
  finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
  }
}

main()

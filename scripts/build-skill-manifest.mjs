/*
 * 作者: Harley-xk
 * 创建: 2026-10-24
 *
 * 描述: 发版 skill 分发产物构建：按版本目录复制 skill 文件并生成 manifest.json（版本 + 每个文件 sha256 + 公开接口 URL）
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'

const SKILL_NAME = 'apphub-release'
/** 后端公开分发接口前缀（与 skill.controller 路由一致） */
const API_BASE = `/api/skill/${SKILL_NAME}`

const { values } = parseArgs({
  options: {
    source: { type: 'string', default: 'skills/apphub-release' },
    // 产物落 server/dist，随发布包 server 目录部署；接口不依赖 nginx 静态配置
    output: { type: 'string', default: 'server/dist/skill/apphub-release' },
    installer: { type: 'string', default: 'scripts/install-skill.mjs' },
    // 冷启动说明独立于技能包（用户未安装技能时也能拿到），来自接入手册
    'install-doc': { type: 'string', default: 'docs/接入手册/技能安装与更新.md' },
  },
})

/** 纳入分发的文件白名单（skill 根下只维护这三类；应用侧配置不进 skill 目录） */
function isDistributable(rel) {
  return rel === 'SKILL.md' || rel === 'VERSION' || rel.startsWith('scripts/')
}

/** 递归收集相对路径（统一 / 分隔，跨平台产物一致） */
async function collectFiles(dir, base = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory())
      files.push(...await collectFiles(path.join(dir, entry.name), rel))
    else if (isDistributable(rel))
      files.push(rel)
  }
  return files
}

async function sha256(file) {
  const content = await fs.readFile(file)
  return createHash('sha256').update(content).digest('hex')
}

async function main() {
  const source = path.resolve(values.source)
  const output = path.resolve(values.output)
  const version = (await fs.readFile(path.join(source, 'VERSION'), 'utf8')).trim()
  if (!version)
    throw new Error(`skill 版本文件为空：${path.join(source, 'VERSION')}`)

  const versionDir = path.join(output, version)
  await fs.rm(versionDir, { recursive: true, force: true })
  await fs.mkdir(versionDir, { recursive: true })

  const files = (await collectFiles(source)).sort()
  const manifestFiles = []
  for (const rel of files) {
    const src = path.join(source, rel)
    const dest = path.join(versionDir, rel)
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.copyFile(src, dest)
    manifestFiles.push({
      path: rel,
      url: `${API_BASE}/files/${version}/${rel}`,
      sha256: await sha256(dest),
      size: (await fs.stat(dest)).size,
    })
  }

  // 冷启动入口（稳定 URL，不随版本目录）：安装器 + 安装说明，供未安装 / 旧版无 self-update 的场景使用
  const installDocSource = path.resolve(values['install-doc'])
  const extras = {}
  for (const [name, src, url] of [
    ['install.mjs', path.resolve(values.installer), `${API_BASE}/install.mjs`],
    ['INSTALL.md', installDocSource, `${API_BASE}`],
  ]) {
    const dest = path.join(output, name)
    await fs.copyFile(src, dest)
    extras[name] = { path: name, url, sha256: await sha256(dest), size: (await fs.stat(dest)).size }
  }

  const manifest = {
    name: SKILL_NAME,
    version,
    generatedAt: new Date().toISOString(),
    files: manifestFiles,
    installer: extras['install.mjs'],
    installDoc: extras['INSTALL.md'],
  }
  await fs.writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  console.log(`✓ skill 分发产物已生成：${path.join(output, 'manifest.json')}`)
  console.log(`  版本 ${version}，文件 ${manifestFiles.length} 个：${manifestFiles.map(file => file.path).join(', ')}`)
  console.log(`  冷启动入口：install.mjs / INSTALL.md`)
}

main().catch((error) => {
  console.error(`✗ 生成 skill 分发产物失败：${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})

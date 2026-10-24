import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { NotFoundException } from '@nestjs/common'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { SkillDistributionService } from './skill.service'

const VERSION = '1.4.0'

let distDir: string

function writeFixture(dir: string): void {
  fs.mkdirSync(path.join(dir, VERSION, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '# skill')
  fs.writeFileSync(path.join(dir, 'INSTALL.md'), '# install')
  fs.writeFileSync(path.join(dir, 'install.mjs'), 'console.log(1)')
  fs.writeFileSync(path.join(dir, VERSION, 'SKILL.md'), '# skill')
  fs.writeFileSync(path.join(dir, VERSION, 'VERSION'), VERSION)
  fs.writeFileSync(path.join(dir, VERSION, 'scripts', 'apphub.mjs'), 'console.log(2)')
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    name: 'apphub-release',
    version: VERSION,
    generatedAt: '2026-10-24T08:00:00.000Z',
    files: [
      { path: 'SKILL.md', url: `/api/skill/apphub-release/files/${VERSION}/SKILL.md`, sha256: 'a'.repeat(64), size: 7 },
      { path: 'VERSION', url: `/api/skill/apphub-release/files/${VERSION}/VERSION`, sha256: 'b'.repeat(64), size: 5 },
      { path: 'scripts/apphub.mjs', url: `/api/skill/apphub-release/files/${VERSION}/scripts/apphub.mjs`, sha256: 'c'.repeat(64), size: 14 },
    ],
    installer: { path: 'install.mjs', url: '/api/skill/apphub-release/install.mjs', sha256: 'd'.repeat(64), size: 14 },
    installDoc: { path: 'INSTALL.md', url: '/api/skill/apphub-release', sha256: 'e'.repeat(64), size: 9 },
  }))
}

function makeService(dir: string): SkillDistributionService {
  return new SkillDistributionService({ get: () => dir } as never)
}

beforeEach(() => {
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apphub-skill-'))
  writeFixture(distDir)
})

afterEach(() => {
  fs.rmSync(distDir, { recursive: true, force: true })
})

describe('SkillDistributionService', () => {
  it('应透出版本清单与冷启动文件原文', async () => {
    const service = makeService(distDir)
    await expect(service.getManifest()).resolves.toMatchObject({ name: 'apphub-release', version: VERSION })
    await expect(service.getInstallDoc()).resolves.toBe('# install')
    await expect(service.getInstaller()).resolves.toBe('console.log(1)')
  })

  it('版本化文件只允许清单内路径且版本必须匹配', async () => {
    const service = makeService(distDir)
    await expect(service.getSkillFile(VERSION, 'SKILL.md')).resolves.toBe('# skill')
    await expect(service.getSkillFile(VERSION, 'scripts/apphub.mjs')).resolves.toBe('console.log(2)')
    await expect(service.getSkillFile('9.9.9', 'SKILL.md')).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.getSkillFile(VERSION, 'manifest.json')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('路径穿越与清单外文件一律拒绝', async () => {
    const service = makeService(distDir)
    await expect(service.getSkillFile(VERSION, '../secret')).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.getSkillFile(VERSION, '../../etc/passwd')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('分发产物缺失时应返回 404 而非暴露文件系统路径', async () => {
    const missing = path.join(distDir, 'missing')
    const service = makeService(missing)
    await expect(service.getManifest()).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.getInstallDoc()).rejects.toBeInstanceOf(NotFoundException)
  })
})

import { describe, expect, it, jest } from '@jest/globals'

import type { MemberLoginLockEntity } from '../entities/member-login-lock.entity'
import { MemberErrorCode } from '../error-codes'
import { LOGIN_LOCK_MAX_FAILURES, LOGIN_LOCK_MINUTES } from '../member.constants'
import { LoginLockService } from './login-lock.service'

/** 行级内存桩：镜像 insert / update / delete / findOne 语义 */
function makeRepository(options: { initial?: Partial<MemberLoginLockEntity> | null } = {}) {
  let row: Partial<MemberLoginLockEntity> | null = options.initial ? { ...options.initial } : null
  const insertCalls: unknown[] = []
  return {
    insertCalls,
    findOne: jest.fn(() => Promise.resolve(row ? { ...row } : null)),
    insert: jest.fn((entity: Partial<MemberLoginLockEntity>) => {
      if (row)
        return Promise.reject(new Error('duplicate key value violates unique constraint'))
      row = { ...entity }
      insertCalls.push(entity)
      return Promise.resolve()
    }),
    update: jest.fn((_where: unknown, changes: Partial<MemberLoginLockEntity>) => {
      Object.assign(row!, changes)
      return Promise.resolve()
    }),
    delete: jest.fn(() => {
      row = null
      return Promise.resolve()
    }),
  }
}

function makeService(initial?: Partial<MemberLoginLockEntity> | null) {
  const repository = makeRepository({ initial })
  const service = new LoginLockService(repository as never)
  return { service, repository }
}

describe('LoginLockService', () => {
  it('未锁定 / 无记录时 getLockedUntil 应返回 null', async () => {
    const none = makeService(null)
    await expect(none.service.getLockedUntil('ah_app000000000001', 'password', 'user01')).resolves.toBeNull()
    const counting = makeService({ failCount: 2, lockedUntil: null, lastFailAt: new Date() })
    await expect(counting.service.getLockedUntil('ah_app000000000001', 'password', 'user01')).resolves.toBeNull()
  })

  it('锁定中的 getLockedUntil 应返回截止时间', async () => {
    const until = new Date(Date.now() + 60_000)
    const { service } = makeService({ failCount: 5, lockedUntil: until, lastFailAt: new Date() })
    await expect(service.getLockedUntil('ah_app000000000001', 'password', 'user01')).resolves.toEqual(until)
  })

  it('锁定已过期视同未锁定（惩罚结束，不叠加历史）', async () => {
    const { service } = makeService({ failCount: 5, lockedUntil: new Date(Date.now() - 1000), lastFailAt: new Date() })
    await expect(service.getLockedUntil('ah_app000000000001', 'password', 'user01')).resolves.toBeNull()
  })

  it('达到阈值（连续 5 次）应写入锁定截止时间（15 分钟）', async () => {
    const { service, repository } = makeService({ failCount: LOGIN_LOCK_MAX_FAILURES - 1, lastFailAt: new Date() })
    await service.recordFailure('ah_app000000000001', 'password', 'user01')
    const updateCalls = repository.update.mock.calls as unknown as [unknown, Partial<MemberLoginLockEntity>][]
    const lockCall = updateCalls.find(([, changes]) => changes.lockedUntil !== undefined)
    expect(lockCall).toBeDefined()
    const margin = 5000
    const expected = LOGIN_LOCK_MINUTES * 60 * 1000
    expect(lockCall![1].lockedUntil!.getTime()).toBeGreaterThan(Date.now() + expected - margin)
    expect(lockCall![1].lockedUntil!.getTime()).toBeLessThan(Date.now() + expected + margin)
  })

  it('计数累计应逐次 +1，未达阈值不锁定', async () => {
    const { service, repository } = makeService({ failCount: 1, lastFailAt: new Date() })
    await service.recordFailure('ah_app000000000001', 'password', 'user01')
    const updateCalls = repository.update.mock.calls as unknown as [unknown, Partial<MemberLoginLockEntity>][]
    expect(updateCalls.some(([, changes]) => changes.failCount === 2 && changes.lockedUntil === undefined)).toBe(true)
  })

  it('无记录的首次失败应插入计数 1', async () => {
    const { service, repository } = makeService(null)
    await service.recordFailure('ah_app000000000001', 'password', 'user01')
    expect(repository.insertCalls[0]).toMatchObject({ failCount: 1 })
  })

  it('并发首次插入撞唯一键应退化为累加路径（计数不丢）', async () => {
    const repository = makeRepository({ initial: { failCount: 3, lastFailAt: new Date() } })
    // 强制 insert 前行已存在（findOne 首次返回 null 模拟并发窗口）
    let findOneCalls = 0
    repository.findOne.mockImplementation(() => {
      findOneCalls++
      return Promise.resolve(findOneCalls === 1 ? null : { failCount: 3, lastFailAt: new Date() })
    })
    const increment = jest.fn(() => Promise.resolve())
    ;(repository as unknown as { increment: unknown }).increment = increment
    const service = new LoginLockService(repository as never)
    await service.recordFailure('ah_app000000000001', 'password', 'user01')
    expect(increment).toHaveBeenCalled()
  })

  it('成功登录应删除计数行（清零契约）', async () => {
    const { service, repository } = makeService({ failCount: 4, lastFailAt: new Date() })
    await service.recordSuccess('ah_app000000000001', 'password', 'user01')
    expect(repository.delete).toHaveBeenCalledWith({
      appKey: 'ah_app000000000001',
      credentialType: 'password',
      identifier: 'user01',
    })
  })
})

describe('LoginLockService 错误码契约', () => {
  it('锁定错误码应为 0043002（LOGIN_LOCKED 分段常量契约）', () => {
    expect(MemberErrorCode.LOGIN_LOCKED.code).toBe(400300002)
    expect(MemberErrorCode.LOGIN_FAILED.code).toBe(400300001)
  })
})

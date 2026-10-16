/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 会员登录日志服务：认证链路异步入库入口（失败仅告警不阻断主链路，队列内建兜底）
 */
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'

import { AsyncTaskQueue } from '../../../common/async/async-task-queue'
import { MemberLoginLogEntity } from '../entities/member-login-log.entity'

@Injectable()
export class MemberLoginLogService {
  constructor(
    @InjectRepository(MemberLoginLogEntity)
    private readonly logRepository: Repository<MemberLoginLogEntity>,
    private readonly taskQueue: AsyncTaskQueue,
  ) {}

  /**
   * 异步记录一条登录 / 登出日志：实体为认证服务组装完的纯数据，
   * 经异步队列入库，失败仅告警、**任何情况下不阻断认证链路**（同 system 域先例）。
   */
  record(entity: MemberLoginLogEntity): void {
    this.taskQueue.submit(async () => {
      await this.logRepository.insert(entity)
    })
  }
}

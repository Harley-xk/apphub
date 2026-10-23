/*
 * 作者: Harley-xk
 * 创建: 2026-10-16
 *
 * 描述: 更新通道服务：应用内通道管理（code 唯一性含软删历史——删后不可复用，设计 §4.6；stable 通道不可删，主张 A1）
 */
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Not } from 'typeorm'
import type { Repository } from 'typeorm'

import { businessError } from '../../../common/exceptions/business-error'
import { AppService } from '../app/app.service'
import { CHANNEL_STATUS, STABLE_CHANNEL_CODE } from '../appcenter.constants'
import { AppChannelEntity } from '../entities/app-channel.entity'
import { AppcenterErrorCode } from '../error-codes'
import type { ChannelCreateDto, ChannelUpdateDto, ChannelVo } from './dto/channel.dto'

@Injectable()
export class ChannelService {
  constructor(
    @InjectRepository(AppChannelEntity)
    private readonly channelRepository: Repository<AppChannelEntity>,
    private readonly appService: AppService,
  ) {}

  /** 应用内通道全量列表（数量有限不分页；路径 :id 即 appId，先做存在性与数据范围校验） */
  async list(appId: string, userId: string): Promise<ChannelVo[]> {
    await this.appService.assertAccessible(userId, appId)
    const list = await this.channelRepository.find({
      where: { appId },
      order: { sort: 'ASC', createTime: 'ASC' },
    })
    return list.map(channel => this.toVo(channel))
  }

  /** 创建通道：code 查重（含软删历史——withDeleted 口径，设计 §4.6） */
  async create(appId: string, dto: ChannelCreateDto, userId: string): Promise<string> {
    await this.appService.assertAccessible(userId, appId)
    await this.validateCodeAvailable(appId, dto.code)
    const channel = await this.channelRepository.save(
      this.channelRepository.create({
        appId,
        code: dto.code,
        name: dto.name,
        status: CHANNEL_STATUS.ENABLED,
        sort: dto.sort ?? 0,
      }),
    )
    return channel.id
  }

  /** 更新通道（code 不参与更新：参与 OSS 对象键与 feed URL，创建后不可改） */
  async update(appId: string, channelId: string, dto: ChannelUpdateDto, userId: string): Promise<void> {
    await this.appService.assertAccessible(userId, appId)
    const channel = await this.getExistsChannel(appId, channelId)
    channel.name = dto.name
    channel.status = dto.status ?? channel.status
    channel.sort = dto.sort ?? channel.sort
    await this.channelRepository.save(channel)
  }

  /** 删除通道：stable 不可删（主张 A1） */
  async remove(appId: string, channelId: string, userId: string): Promise<void> {
    await this.appService.assertAccessible(userId, appId)
    const channel = await this.getExistsChannel(appId, channelId)
    if (channel.code === STABLE_CHANNEL_CODE) {
      throw businessError(AppcenterErrorCode.STABLE_CHANNEL_UNREMOVABLE.message, {
        code: AppcenterErrorCode.STABLE_CHANNEL_UNREMOVABLE,
      })
    }
    await this.channelRepository.softRemove(channel)
  }

  /** 按 code 查应用内通道（版本创建 / 更新检测用；软删行不可见） */
  async findByCode(appId: string, code: string): Promise<AppChannelEntity | null> {
    return this.channelRepository.findOne({ where: { appId, code } })
  }

  /** code 可用性校验：应用内唯一，含软删历史（排除自身） */
  private async validateCodeAvailable(appId: string, code: string, excludeId?: string): Promise<void> {
    // withDeleted：软删行的 code 仍占位（删后重建撞历史数据由应用层拦截，设计 §4.6）
    const duplicated = await this.channelRepository.findOne({
      where: excludeId ? { appId, code, id: Not(excludeId) } : { appId, code },
      withDeleted: true,
    })
    if (duplicated) {
      throw businessError(AppcenterErrorCode.CHANNEL_CODE_DUPLICATE.message, {
        code: AppcenterErrorCode.CHANNEL_CODE_DUPLICATE,
      })
    }
  }

  /** 按主键查通道（限定所属应用）：不存在抛 CHANNEL_NOT_EXISTS */
  private async getExistsChannel(appId: string, channelId: string): Promise<AppChannelEntity> {
    const channel = await this.channelRepository.findOne({ where: { id: channelId, appId } })
    if (!channel) {
      throw businessError(AppcenterErrorCode.CHANNEL_NOT_EXISTS.message, {
        code: AppcenterErrorCode.CHANNEL_NOT_EXISTS,
      })
    }
    return channel
  }

  /** 实体转出参：白名单映射 */
  private toVo(channel: AppChannelEntity): ChannelVo {
    return {
      id: channel.id,
      appId: channel.appId,
      code: channel.code,
      name: channel.name,
      status: channel.status,
      sort: channel.sort,
      createTime: channel.createTime,
    }
  }
}

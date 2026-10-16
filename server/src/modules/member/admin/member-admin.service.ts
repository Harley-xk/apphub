/*
 * 作者: Harley-xk
 * 创建: 2026-10-17
 *
 * 描述: 会员管理服务：列表 / 详情（脱敏）/ 启停（禁用吊销全部令牌）/ 软删 / 解绑凭证 / 重置密码（统一认证设计 §3.4）
 */
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import * as bcrypt from 'bcryptjs'
import { randomInt } from 'node:crypto'
import { Brackets } from 'typeorm'
import type { Repository } from 'typeorm'

import { businessError } from '../../../common/exceptions/business-error'
import type { PageResult } from '../../../common/interfaces/page-result.interface'
import { MemberTokenService } from '../auth/member-token.service'
import { MemberCredentialEntity } from '../entities/member-credential.entity'
import { MemberEntity } from '../entities/member.entity'
import { MemberErrorCode } from '../error-codes'
import { BCRYPT_COST, CREDENTIAL_TYPE, MEMBER_STATUS, RESET_PASSWORD_LENGTH } from '../member.constants'
import type {
  CredentialVo,
  MemberDetailVo,
  MemberPageDto,
  MemberVo,
  ResetPasswordVo,
} from './dto/member.dto'

/** 随机密码字符集（去掉 0/O/1/l 易混淆字符） */
const PASSWORD_LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
const PASSWORD_DIGITS = '23456789'
const PASSWORD_ALL = `${PASSWORD_LETTERS}${PASSWORD_DIGITS}`

@Injectable()
export class MemberAdminService {
  constructor(
    @InjectRepository(MemberEntity)
    private readonly memberRepository: Repository<MemberEntity>,
    @InjectRepository(MemberCredentialEntity)
    private readonly credentialRepository: Repository<MemberCredentialEntity>,
    private readonly tokenService: MemberTokenService,
  ) {}

  /** 分页列表：关键字匹配 昵称 或 手机 / 邮箱凭证标识（列表行内联脱敏后的手机 / 邮箱） */
  async getPage(dto: MemberPageDto): Promise<PageResult<MemberVo>> {
    const keyword = dto.keyword?.trim()
    const qb = this.memberRepository.createQueryBuilder('m')
    if (keyword) {
      const credentialMatch = qb.subQuery()
        .select('1')
        .from(MemberCredentialEntity, 'c')
        .where('c.memberId = m.id')
        .andWhere('c.deletedAt IS NULL')
        .andWhere('c.credentialType IN (:...contactTypes)')
        .andWhere('c.identifier ILIKE :kw')
        .getQuery()
      qb.andWhere(new Brackets(qb2 => qb2
        .where('m.nickname ILIKE :kw')
        .orWhere(`EXISTS ${credentialMatch}`)))
      qb.setParameter('kw', `%${keyword}%`)
      qb.setParameter('contactTypes', [CREDENTIAL_TYPE.PHONE, CREDENTIAL_TYPE.EMAIL])
    }
    qb.orderBy('m.createTime', 'DESC')
    qb.skip((dto.pageNo - 1) * dto.pageSize)
    qb.take(dto.pageSize)
    const [list, total] = await qb.getManyAndCount()

    // 列表行内联手机 / 邮箱（一次批量查询，避免逐行 N+1）
    const contactMap = await this.loadContactMap(list.map(m => m.id))
    return { list: list.map(m => this.toVo(m, contactMap)), total }
  }

  /** 详情：会员 + 凭证清单（脱敏，密文不出现） */
  async get(id: string): Promise<MemberDetailVo> {
    const member = await this.getExistsMember(id)
    const credentials = await this.credentialRepository.find({
      where: { memberId: id },
      order: { createTime: 'ASC' },
    })
    const contactMap = await this.loadContactMap([id])
    return { ...this.toVo(member, contactMap), credentials: credentials.map(c => this.toCredentialVo(c)) }
  }

  /** 禁用：全部令牌即时吊销（逐请求查库保证 access 同步失效，refresh 立即不可用） */
  async disable(id: string): Promise<void> {
    const member = await this.getExistsMember(id)
    if (member.status !== MEMBER_STATUS.DISABLED) {
      await this.memberRepository.update(id, { status: MEMBER_STATUS.DISABLED })
    }
    await this.tokenService.revokeAllForMember(id)
  }

  /** 启用：仅恢复状态（令牌已吊销的需重新登录） */
  async enable(id: string): Promise<void> {
    await this.getExistsMember(id)
    await this.memberRepository.update(id, { status: MEMBER_STATUS.ACTIVE })
  }

  /** 软删：凭证一并软删（标识不释放，防抢注——§4.2）+ 全部令牌吊销 */
  async remove(id: string): Promise<void> {
    const member = await this.getExistsMember(id)
    const credentials = await this.credentialRepository.find({ where: { memberId: id } })
    await this.credentialRepository.softRemove(credentials)
    await this.memberRepository.softRemove(member)
    await this.tokenService.revokeAllForMember(id)
  }

  /** 解绑凭证：最后一条密码凭证拒绝（会员将失去全部自助登录途径） */
  async unbindCredential(memberId: string, credentialId: string): Promise<void> {
    await this.getExistsMember(memberId)
    const credential = await this.credentialRepository.findOne({
      where: { id: credentialId, memberId },
    })
    if (!credential) {
      throw businessError(MemberErrorCode.CREDENTIAL_NOT_EXISTS.message, {
        code: MemberErrorCode.CREDENTIAL_NOT_EXISTS,
      })
    }
    if (credential.credentialType === CREDENTIAL_TYPE.PASSWORD) {
      const passwordCount = await this.credentialRepository.count({
        where: { memberId, credentialType: CREDENTIAL_TYPE.PASSWORD },
      })
      if (passwordCount <= 1) {
        throw businessError(MemberErrorCode.LAST_PASSWORD_CREDENTIAL.message, {
          code: MemberErrorCode.LAST_PASSWORD_CREDENTIAL,
        })
      }
    }
    await this.credentialRepository.softRemove(credential)
    // 解绑属凭证变更：吊销全部令牌（统一认证设计主张 M1）
    await this.tokenService.revokeAllForMember(memberId)
  }

  /** 管理员重置密码：生成随机新密码（明文仅此一次返回），吊销全部令牌 */
  async resetPassword(memberId: string): Promise<ResetPasswordVo> {
    await this.getExistsMember(memberId)
    const credential = await this.credentialRepository.findOne({
      where: { memberId, credentialType: CREDENTIAL_TYPE.PASSWORD },
    })
    if (!credential) {
      throw businessError(MemberErrorCode.CREDENTIAL_NOT_EXISTS.message, {
        code: MemberErrorCode.CREDENTIAL_NOT_EXISTS,
      })
    }
    const password = this.generatePassword()
    await this.credentialRepository.update(credential.id, {
      credentialSecret: bcrypt.hashSync(password, BCRYPT_COST),
    })
    await this.tokenService.revokeAllForMember(memberId)
    return { password }
  }

  /** 批量取会员的手机 / 邮箱凭证标识（列表内联展示，键为会员 id） */
  private async loadContactMap(memberIds: string[]): Promise<Map<string, { phone: string | null, email: string | null }>> {
    const map = new Map<string, { phone: string | null, email: string | null }>()
    if (memberIds.length === 0)
      return map
    const rows = await this.credentialRepository
      .createQueryBuilder('c')
      .where('c.memberId IN (:...ids)', { ids: memberIds })
      .andWhere('c.credentialType IN (:...types)', { types: [CREDENTIAL_TYPE.PHONE, CREDENTIAL_TYPE.EMAIL] })
      .andWhere('c.deletedAt IS NULL')
      .getMany()
    for (const row of rows) {
      const entry = map.get(row.memberId) ?? { phone: null, email: null }
      if (row.credentialType === CREDENTIAL_TYPE.PHONE)
        entry.phone = maskIdentifier(row.credentialType, row.identifier)
      if (row.credentialType === CREDENTIAL_TYPE.EMAIL)
        entry.email = maskIdentifier(row.credentialType, row.identifier)
      map.set(row.memberId, entry)
    }
    return map
  }

  private toVo(member: MemberEntity, contactMap: Map<string, { phone: string | null, email: string | null }>): MemberVo {
    const contact = contactMap.get(member.id) ?? { phone: null, email: null }
    return {
      id: member.id,
      nickname: member.nickname,
      avatarUrl: member.avatarUrl,
      status: member.status,
      phone: contact.phone,
      email: contact.email,
      registeredAppId: member.registeredAppId,
      lastLoginAt: member.lastLoginAt,
      createTime: member.createTime,
    }
  }

  private toCredentialVo(credential: MemberCredentialEntity): CredentialVo {
    return {
      id: credential.id,
      credentialType: credential.credentialType,
      identifier: maskIdentifier(credential.credentialType, credential.identifier),
      verified: credential.verified,
      lastUsedAt: credential.lastUsedAt,
      createTime: credential.createTime,
    }
  }

  private async getExistsMember(id: string): Promise<MemberEntity> {
    const member = await this.memberRepository.findOne({ where: { id } })
    if (!member) {
      throw businessError(MemberErrorCode.MEMBER_NOT_EXISTS.message, {
        code: MemberErrorCode.MEMBER_NOT_EXISTS,
      })
    }
    return member
  }

  /** 随机密码：长度 12，保证至少一个字母 + 一个数字（满足 §3.3 强度规则） */
  private generatePassword(): string {
    const pick = (set: string): string => set[randomInt(set.length)]
    const chars = [pick(PASSWORD_LETTERS), pick(PASSWORD_DIGITS)]
    while (chars.length < RESET_PASSWORD_LENGTH)
      chars.push(pick(PASSWORD_ALL))
    // Fisher-Yates 洗牌，避免首两位恒为字母 / 数字被规律猜测
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1)
      ;[chars[i], chars[j]] = [chars[j], chars[i]]
    }
    return chars.join('')
  }
}

/** 标识脱敏：按凭证类型打码（password 为自设账号原样——非隐私标识） */
export function maskIdentifier(type: string, identifier: string): string {
  if (type === CREDENTIAL_TYPE.PASSWORD)
    return identifier
  if (type === CREDENTIAL_TYPE.PHONE) {
    if (identifier.length < 7)
      return '****'
    return `${identifier.slice(0, 3)}****${identifier.slice(-4)}`
  }
  if (type === CREDENTIAL_TYPE.EMAIL) {
    const atIndex = identifier.indexOf('@')
    if (atIndex <= 0)
      return '****'
    return `${identifier.slice(0, 1)}***${identifier.slice(atIndex)}`
  }
  // 微信 openid / 支付宝 user_id：保留前 6 后 4
  if (identifier.length <= 10)
    return '****'
  return `${identifier.slice(0, 6)}****${identifier.slice(-4)}`
}

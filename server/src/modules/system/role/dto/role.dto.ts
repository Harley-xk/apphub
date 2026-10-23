/*
 * 作者: Harley-xk
 * 创建: 2026-09-28
 *
 * 描述: 角色域 DTO 集：分页 / 创建 / 更新 / 权限分配入参与列表、详情出参契约
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

import { PageParamDto } from '../../../../common/dto/page.dto'
import { DATA_SCOPE_VALUES } from '../../system.constants'

/** 角色列表出参 */
export interface RoleVo {
  id: string
  name: string
  code: string
  sort: number
  status: boolean
  /** 数据范围：all 全局 / app 按应用收窄 */
  dataScope: string
  remark: string | null
  createTime: Date
}

/** 角色详情出参（含已分配权限串回显——读取侧不过滤注册表，见权限设计 §4.3） */
export interface RoleDetailVo extends RoleVo {
  permissions: string[]
}

export class RolePageDto extends PageParamDto {
  @ApiPropertyOptional({ description: '角色名称模糊匹配' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string

  @ApiPropertyOptional({ description: '启用状态' })
  @IsOptional()
  @IsBoolean()
  status?: boolean
}

export class RoleCreateDto {
  @ApiProperty({ description: '角色名称', example: '运营专员' })
  @IsString()
  @IsNotEmpty({ message: '角色名称不能为空' })
  @MaxLength(50)
  name: string

  @ApiProperty({ description: '角色标识（小写字母/数字/中划线）', example: 'operator' })
  @IsString()
  @IsNotEmpty({ message: '角色标识不能为空' })
  @MaxLength(50)
  @Matches(/^[a-z][a-z0-9-]*$/, { message: '角色标识须为小写字母开头的字母/数字/中划线组合' })
  code: string

  @ApiPropertyOptional({ description: '显示排序，越小越靠前' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sort?: number

  @ApiPropertyOptional({ description: '数据范围（all 全部应用 / app 按应用收窄），默认 all' })
  @IsOptional()
  @IsIn(DATA_SCOPE_VALUES, { message: '数据范围取值须为 all / app' })
  dataScope?: string

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string
}

export class RoleUpdateDto {
  @ApiProperty({ description: '角色 id' })
  @IsUUID()
  id: string

  @ApiProperty({ description: '角色名称' })
  @IsString()
  @IsNotEmpty({ message: '角色名称不能为空' })
  @MaxLength(50)
  name: string

  @ApiProperty({ description: '启用状态' })
  @IsBoolean()
  status: boolean

  @ApiPropertyOptional({ description: '显示排序' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sort?: number

  @ApiPropertyOptional({ description: '数据范围（all 全部应用 / app 按应用收窄）' })
  @IsOptional()
  @IsIn(DATA_SCOPE_VALUES, { message: '数据范围取值须为 all / app' })
  dataScope?: string

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string
}

export class RoleAssignPermissionsDto {
  @ApiProperty({ description: '角色 id' })
  @IsUUID()
  id: string

  @ApiProperty({ description: '权限串全集（差集增量绑定，逐串校验注册表登记）', type: [String] })
  @IsArray()
  @ArrayUnique({ message: '权限串不得重复' })
  @ArrayMaxSize(500)
  @IsString({ each: true })
  permissions: string[]
}

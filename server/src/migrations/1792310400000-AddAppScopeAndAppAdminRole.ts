import { MigrationInterface, QueryRunner } from 'typeorm'

import { APP_ADMIN_ROLE_CODE, APP_ADMIN_ROLE_ID } from '../modules/system/system.constants'

/**
 * 应用管理员与数据范围（应用管理员与数据范围设计 §10）：
 * 1. system_roles 加 data_scope（存量角色一律 all，行为不变）
 * 2. 建 system_user_app_scope 账户-应用授权表（纯关联值对象，物理删除）
 * 3. 插入 app_admin 种子角色与 20 条权限行（普通角色，可改名 / 改权限 / 删除）
 *
 * 手写迁移（迁移是唯一建表通道，ADR-005）；回滚按逆序删除种子行 / 表 / 列。
 */
export class AddAppScopeAndAppAdminRole1792310400000 implements MigrationInterface {
  name = 'AddAppScopeAndAppAdminRole1792310400000'

  /** app_admin 预置权限清单（20 项：应用信息维护 + 通道 / 版本 / 安装包 + 订阅全量管理） */
  private readonly appAdminPermissions = [
    'appcenter:app:query',
    'appcenter:app:update',
    'appcenter:channel:query',
    'appcenter:channel:create',
    'appcenter:channel:update',
    'appcenter:channel:remove',
    'appcenter:version:query',
    'appcenter:version:create',
    'appcenter:version:update',
    'appcenter:version:remove',
    'appcenter:version:publish',
    'appcenter:version:offline',
    'subscription:plan:query',
    'subscription:plan:create',
    'subscription:plan:update',
    'subscription:plan:remove',
    'subscription:order:query',
    'subscription:order:offline-create',
    'subscription:order:close',
    'subscription:sub:query',
  ]

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 角色数据范围列（默认 all：存量角色迁移后行为不变）
    await queryRunner.query(
      `ALTER TABLE "system_roles" ADD COLUMN "data_scope" character varying(16) NOT NULL DEFAULT 'all'`,
    )
    // 2. 账户-应用授权表（唯一索引 (user_id, app_id)，物理删除的纯关联值对象）
    await queryRunner.query(
      `CREATE TABLE "system_user_app_scope" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "app_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_system_user_app_scope" PRIMARY KEY ("id"))`,
    )
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uk_system_user_app_scope" ON "system_user_app_scope" ("user_id", "app_id") `,
    )
    // 3. 预置角色：应用管理员（data_scope = app，仅能操作被授权的应用）
    await queryRunner.query(
      `INSERT INTO "system_roles" ("id", "name", "code", "sort", "status", "remark", "data_scope")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        APP_ADMIN_ROLE_ID,
        '应用管理员',
        APP_ADMIN_ROLE_CODE,
        10,
        true,
        '预置角色：仅能操作被授权的应用',
        'app',
      ],
    )
    // 3.1 权限行（写入侧与代码注册表一致：未登记权限串不会被分配，种子按设计清单静态写入）
    for (const permission of this.appAdminPermissions) {
      await queryRunner.query(
        `INSERT INTO "system_role_permission" ("role_id", "permission") VALUES ($1, $2)`,
        [APP_ADMIN_ROLE_ID, permission],
      )
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "system_role_permission" WHERE "role_id" = $1`, [APP_ADMIN_ROLE_ID])
    await queryRunner.query(`DELETE FROM "system_roles" WHERE "id" = $1`, [APP_ADMIN_ROLE_ID])
    await queryRunner.query(`DROP INDEX "public"."uk_system_user_app_scope"`)
    await queryRunner.query(`DROP TABLE "system_user_app_scope"`)
    await queryRunner.query(`ALTER TABLE "system_roles" DROP COLUMN "data_scope"`)
  }
}

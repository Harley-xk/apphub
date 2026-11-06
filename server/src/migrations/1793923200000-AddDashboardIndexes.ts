import { MigrationInterface, QueryRunner } from 'typeorm'

import { DASHBOARD_PERMISSION_CODES } from '../modules/dashboard/permissions'
import { APP_ADMIN_ROLE_ID } from '../modules/system/system.constants'

/**
 * 运营工作台（M7 设计 §5.4 / §2）：
 * 1. 补三条统计索引（member 区间新增 / subscription 有效与到期扫描 / member_login_lock 锁定计数）；
 * 2. 为 app_admin 预置角色追加 dashboard:overview:query（20 → 21 项），保证应用管理员可进入工作台；
 *    会员块仍因其无 member:* 而隐藏。
 *
 * 索引与实体 @Index 装饰器同源（实体是 schema 唯一事实源，ADR-005）；本迁移只加索引、不改表。
 */
export class AddDashboardIndexes1793923200000 implements MigrationInterface {
  name = 'AddDashboardIndexes1793923200000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX "idx_member_create_time" ON "member" ("create_time")`)
    await queryRunner.query(
      `CREATE INDEX "idx_subscription_expire" ON "subscription" ("expire_at") WHERE "deleted_at" IS NULL`,
    )
    await queryRunner.query(
      `CREATE INDEX "idx_member_login_lock_locked_until" ON "member_login_lock" ("locked_until")`,
    )
    // 幂等追加：角色已删除或权限行已存在时不插入（本地重跑 / 手工补过的库均安全）
    await queryRunner.query(
      `INSERT INTO "system_role_permission" ("role_id", "permission")
       SELECT $1::uuid, $2::character varying
       WHERE EXISTS (SELECT 1 FROM "system_roles" WHERE "id" = $1::uuid)
         AND NOT EXISTS (
           SELECT 1 FROM "system_role_permission"
           WHERE "role_id" = $1::uuid AND "permission" = $2::character varying
         )`,
      [APP_ADMIN_ROLE_ID, DASHBOARD_PERMISSION_CODES.OVERVIEW_QUERY],
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "system_role_permission" WHERE "role_id" = $1 AND "permission" = $2`,
      [APP_ADMIN_ROLE_ID, DASHBOARD_PERMISSION_CODES.OVERVIEW_QUERY],
    )
    await queryRunner.query(`DROP INDEX "public"."idx_member_login_lock_locked_until"`)
    await queryRunner.query(`DROP INDEX "public"."idx_subscription_expire"`)
    await queryRunner.query(`DROP INDEX "public"."idx_member_create_time"`)
  }
}

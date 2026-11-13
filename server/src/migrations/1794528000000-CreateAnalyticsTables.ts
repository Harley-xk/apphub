import { MigrationInterface, QueryRunner } from 'typeorm'

import { ANALYTICS_PERMISSION_CODES } from '../modules/analytics/permissions'
import { APP_ADMIN_ROLE_ID } from '../modules/system/system.constants'

/**
 * 应用活跃度统计（设计 §3 / §7.4）：
 * 1. 建 analytics_device_day 设备-日状态行（唯一事实源，含业务唯一键与两条查询索引）；
 * 2. 建 analytics_device 设备画像（按应用分别建档，first_seen_at 支撑新增设备口径）；
 * 3. 登记 analytics:activity:query 权限点并为 app_admin 预置角色追加（21 → 22 项）。
 *
 * 手写迁移（迁移是唯一建表通道，ADR-005）；回滚按逆序删除权限行 / 表。
 */
export class CreateAnalyticsTables1794528000000 implements MigrationInterface {
  name = 'CreateAnalyticsTables1794528000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 设备-日状态行：唯一键含会员键与维度快照（匿名用全零 UUID 哨兵，无 NULL）
    await queryRunner.query(`CREATE TABLE "analytics_device_day" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "app_id" uuid NOT NULL,
      "stat_date" date NOT NULL,
      "device_id" character varying(64) NOT NULL,
      "member_id" uuid NOT NULL,
      "platform" character varying(16) NOT NULL,
      "arch" character varying(16) NOT NULL DEFAULT '',
      "client_version" character varying(32) NOT NULL,
      "has_start" boolean NOT NULL,
      "has_activate" boolean NOT NULL,
      "has_stop" boolean NOT NULL,
      "first_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "last_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      CONSTRAINT "PK_analytics_device_day" PRIMARY KEY ("id")
    )`)
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uk_analytics_device_day" ON "analytics_device_day" ("app_id", "stat_date", "device_id", "member_id", "platform", "arch", "client_version")`,
    )
    await queryRunner.query(
      `CREATE INDEX "idx_analytics_device_day_app_date" ON "analytics_device_day" ("app_id", "stat_date")`,
    )
    await queryRunner.query(
      `CREATE INDEX "idx_analytics_device_day_app_member" ON "analytics_device_day" ("app_id", "member_id", "stat_date")`,
    )

    // 2. 设备画像：按 (app_id, device_id) 建档；arch 可空（web / 移动端无架构）
    await queryRunner.query(`CREATE TABLE "analytics_device" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "app_id" uuid NOT NULL,
      "device_id" character varying(64) NOT NULL,
      "platform" character varying(16) NOT NULL,
      "arch" character varying(16),
      "last_version" character varying(32) NOT NULL,
      "first_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      CONSTRAINT "PK_analytics_device" PRIMARY KEY ("id")
    )`)
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uk_analytics_device" ON "analytics_device" ("app_id", "device_id")`,
    )
    await queryRunner.query(
      `CREATE INDEX "idx_analytics_device_first_seen" ON "analytics_device" ("app_id", "first_seen_at")`,
    )

    // 3. 权限点与 app_admin 预置（幂等追加：角色已删除或权限行已存在时不插入）
    await queryRunner.query(
      `INSERT INTO "system_role_permission" ("role_id", "permission")
       SELECT $1::uuid, $2::character varying
       WHERE EXISTS (SELECT 1 FROM "system_roles" WHERE "id" = $1::uuid)
         AND NOT EXISTS (
           SELECT 1 FROM "system_role_permission"
           WHERE "role_id" = $1::uuid AND "permission" = $2::character varying
         )`,
      [APP_ADMIN_ROLE_ID, ANALYTICS_PERMISSION_CODES.ACTIVITY_QUERY],
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "system_role_permission" WHERE "role_id" = $1 AND "permission" = $2`,
      [APP_ADMIN_ROLE_ID, ANALYTICS_PERMISSION_CODES.ACTIVITY_QUERY],
    )
    await queryRunner.query(`DROP INDEX "public"."idx_analytics_device_first_seen"`)
    await queryRunner.query(`DROP INDEX "public"."uk_analytics_device"`)
    await queryRunner.query(`DROP TABLE "analytics_device"`)
    await queryRunner.query(`DROP INDEX "public"."idx_analytics_device_day_app_member"`)
    await queryRunner.query(`DROP INDEX "public"."idx_analytics_device_day_app_date"`)
    await queryRunner.query(`DROP INDEX "public"."uk_analytics_device_day"`)
    await queryRunner.query(`DROP TABLE "analytics_device_day"`)
  }
}

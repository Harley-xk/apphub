import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * appcenter 四个 uk_ 唯一索引加固：普通索引 → 部分唯一索引
 *
 * 背景：M1 建表迁移生成的是普通 CREATE INDEX（实体当时未标 unique:true），
 * 本地库曾因 DB_SYNC 重建为 UNIQUE，但迁移链本身从未对齐——新环境按迁移
 * 重建仍会得到普通索引。本迁移把迁移链收敛到与实体声明一致的唯一形态；
 * generate 对部分索引的 unique 差异检测是盲区（比对不到），故手写。
 * 重建瞬时完成，若存量存在重复数据将创建失败（fail-fast，属预期）。
 */
export class HardenAppcenterUniqueIndexes1792170778234 implements MigrationInterface {
  name = 'HardenAppcenterUniqueIndexes1792170778234'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uk_app_app_key"`)
    await queryRunner.query(`CREATE UNIQUE INDEX "uk_app_app_key" ON "app" ("app_key") WHERE deleted_at IS NULL`)
    await queryRunner.query(`DROP INDEX "public"."uk_app_version_scope"`)
    await queryRunner.query(`CREATE UNIQUE INDEX "uk_app_version_scope" ON "app_version" ("app_id", "channel_id", "version") WHERE deleted_at IS NULL`)
    await queryRunner.query(`DROP INDEX "public"."uk_app_package_scope"`)
    await queryRunner.query(`CREATE UNIQUE INDEX "uk_app_package_scope" ON "app_package" ("version_id", "platform", "arch") WHERE deleted_at IS NULL`)
    await queryRunner.query(`DROP INDEX "public"."uk_app_channel_app_code"`)
    await queryRunner.query(`CREATE UNIQUE INDEX "uk_app_channel_app_code" ON "app_channel" ("app_id", "code") WHERE deleted_at IS NULL`)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uk_app_channel_app_code"`)
    await queryRunner.query(`CREATE INDEX "uk_app_channel_app_code" ON "app_channel" ("app_id", "code") WHERE deleted_at IS NULL`)
    await queryRunner.query(`DROP INDEX "public"."uk_app_package_scope"`)
    await queryRunner.query(`CREATE INDEX "uk_app_package_scope" ON "app_package" ("version_id", "platform", "arch") WHERE deleted_at IS NULL`)
    await queryRunner.query(`DROP INDEX "public"."uk_app_version_scope"`)
    await queryRunner.query(`CREATE INDEX "uk_app_version_scope" ON "app_version" ("app_id", "channel_id", "version") WHERE deleted_at IS NULL`)
    await queryRunner.query(`DROP INDEX "public"."uk_app_app_key"`)
    await queryRunner.query(`CREATE INDEX "uk_app_app_key" ON "app" ("app_key") WHERE deleted_at IS NULL`)
  }
}

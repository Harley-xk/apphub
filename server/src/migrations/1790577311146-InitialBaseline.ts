import { type MigrationInterface, type QueryRunner } from 'typeorm'

export class InitialBaseline1790577311146 implements MigrationInterface {
  name = 'InitialBaseline1790577311146'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 基线迁移：工程尚无业务实体，库中无本工程表。
    // 首个业务实体（批次四用户表）出现时由 migration:generate 生成全量 DDL 迁移；
    // 存量库接入纪律见 docs/规划/批次二-数据层基建设计.md §3.4。
    //
    // uuid-ossp 扩展前置创建（2026-10-20 补，RDS 上线批次）：后续迁移的 uuid 主键列
    // DEFAULT uuid_generate_v4() 依赖该扩展；本地开发库为 DB_SYNC 时代手工创建，
    // 全新环境（RDS / 重建库）不会自带——补进最早迁移保证重放即就绪。
    // IF NOT EXISTS 幂等：已建扩展的存量库不受影响（本迁移已执行过不会重放）。
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
  }

  public async down(): Promise<void> {
    // 扩展不随回退卸载（其余库对象可能仍在引用其函数）
  }
}

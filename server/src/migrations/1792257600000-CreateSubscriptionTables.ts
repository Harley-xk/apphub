import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * M3 subscription 域三表：sub_plan / subscription / order（订阅与支付设计 §2）。
 * 手写迁移（M1 教训：TypeORM generate 对部分索引的 unique 差异是检测盲区）——
 * subscription (member_id, app_id) 为部分唯一索引 WHERE deleted_at IS NULL（主张 S7）
 */
export class CreateSubscriptionTables1792257600000 implements MigrationInterface {
  name = 'CreateSubscriptionTables1792257600000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "sub_plan" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "creator" uuid, "create_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updater" uuid, "update_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "app_id" uuid NOT NULL, "name" character varying(64) NOT NULL, "period_type" character varying(16) NOT NULL, "duration_months" integer, "price" integer NOT NULL, "original_price" integer, "status" character varying(16) NOT NULL, "sort" integer NOT NULL DEFAULT '0', "remark" character varying(512), CONSTRAINT "PK_sub_plan" PRIMARY KEY ("id"))`)
    await queryRunner.query(`CREATE INDEX "idx_sub_plan_app" ON "sub_plan" ("app_id") `)
    await queryRunner.query(`CREATE TABLE "subscription" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "creator" uuid, "create_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updater" uuid, "update_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "member_id" uuid NOT NULL, "app_id" uuid NOT NULL, "plan_id" uuid NOT NULL, "start_at" TIMESTAMP WITH TIME ZONE NOT NULL, "expire_at" TIMESTAMP WITH TIME ZONE NOT NULL, "last_renew_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_subscription" PRIMARY KEY ("id"))`)
    await queryRunner.query(`CREATE UNIQUE INDEX "uk_subscription_member_app" ON "subscription" ("member_id", "app_id") WHERE deleted_at IS NULL`)
    await queryRunner.query(`CREATE INDEX "idx_subscription_app" ON "subscription" ("app_id") `)
    await queryRunner.query(`CREATE TABLE "order" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "creator" uuid, "create_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updater" uuid, "update_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "order_no" character varying(32) NOT NULL, "member_id" uuid NOT NULL, "app_id" uuid NOT NULL, "plan_id" uuid NOT NULL, "plan_name" character varying(64) NOT NULL, "period_type" character varying(16) NOT NULL, "amount" integer NOT NULL, "channel" character varying(16) NOT NULL, "status" character varying(16) NOT NULL, "transaction_id" character varying(64), "paid_at" TIMESTAMP WITH TIME ZONE, "expire_at" TIMESTAMP WITH TIME ZONE NOT NULL, "offline_note" character varying(512), CONSTRAINT "PK_order" PRIMARY KEY ("id"))`)
    await queryRunner.query(`CREATE UNIQUE INDEX "uk_order_no" ON "order" ("order_no") `)
    await queryRunner.query(`CREATE INDEX "idx_order_member" ON "order" ("member_id") `)
    await queryRunner.query(`CREATE INDEX "idx_order_app" ON "order" ("app_id") `)
    await queryRunner.query(`CREATE INDEX "idx_order_status_expire" ON "order" ("status", "expire_at") `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_order_status_expire"`)
    await queryRunner.query(`DROP INDEX "public"."idx_order_app"`)
    await queryRunner.query(`DROP INDEX "public"."idx_order_member"`)
    await queryRunner.query(`DROP INDEX "public"."uk_order_no"`)
    await queryRunner.query(`DROP TABLE "order"`)
    await queryRunner.query(`DROP INDEX "public"."idx_subscription_app"`)
    await queryRunner.query(`DROP INDEX "public"."uk_subscription_member_app"`)
    await queryRunner.query(`DROP TABLE "subscription"`)
    await queryRunner.query(`DROP INDEX "public"."idx_sub_plan_app"`)
    await queryRunner.query(`DROP TABLE "sub_plan"`)
  }
}

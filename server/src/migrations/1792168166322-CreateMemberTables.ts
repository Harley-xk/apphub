import { MigrationInterface, QueryRunner } from 'typeorm'

export class CreateMemberTables1792168166322 implements MigrationInterface {
  name = 'CreateMemberTables1792168166322'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "member" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "creator" uuid, "create_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updater" uuid, "update_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "nickname" character varying(64) NOT NULL, "avatar_url" character varying(512), "status" character varying(16) NOT NULL, "registered_app_id" uuid, "last_login_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_97cbbe986ce9d14ca5894fdc072" PRIMARY KEY ("id"))`)
    await queryRunner.query(`CREATE INDEX "idx_member_status" ON "member" ("status") `)
    await queryRunner.query(`CREATE TABLE "member_refresh_token" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "member_id" uuid NOT NULL, "app_id" uuid NOT NULL, "token_hash" character(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "status" character varying(16) NOT NULL, "created_ip" character varying(64), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_ff7e24c08914638ee38c44917b9" PRIMARY KEY ("id"))`)
    await queryRunner.query(`CREATE INDEX "idx_member_refresh_token_member" ON "member_refresh_token" ("member_id") `)
    await queryRunner.query(`CREATE UNIQUE INDEX "uk_member_refresh_token_hash" ON "member_refresh_token" ("token_hash") `)
    await queryRunner.query(`CREATE TABLE "member_login_log" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "member_id" uuid, "app_key" character varying(32) NOT NULL, "credential_type" character varying(16) NOT NULL, "identifier" character varying(128) NOT NULL, "log_type" smallint NOT NULL, "result_code" integer NOT NULL, "result_msg" character varying(255), "ip" character varying(64), "user_agent" character varying(500), "login_time" TIMESTAMP WITH TIME ZONE NOT NULL, "create_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_91d1b1e392f4608772b83e03d10" PRIMARY KEY ("id"))`)
    await queryRunner.query(`CREATE INDEX "idx_member_login_log_app_key" ON "member_login_log" ("app_key") `)
    await queryRunner.query(`CREATE INDEX "idx_member_login_log_time" ON "member_login_log" ("login_time") `)
    await queryRunner.query(`CREATE INDEX "idx_member_login_log_member" ON "member_login_log" ("member_id") `)
    await queryRunner.query(`CREATE TABLE "member_credential" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "creator" uuid, "create_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updater" uuid, "update_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "member_id" uuid NOT NULL, "credential_type" character varying(16) NOT NULL, "identifier" character varying(128) NOT NULL, "credential_secret" character varying(255), "verified" boolean NOT NULL DEFAULT true, "last_used_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_67ab0d2ff051af1c046620d1fb2" PRIMARY KEY ("id"))`)
    await queryRunner.query(`CREATE INDEX "idx_member_credential_member" ON "member_credential" ("member_id") `)
    await queryRunner.query(`CREATE UNIQUE INDEX "uk_member_credential_type_identifier" ON "member_credential" ("credential_type", "identifier") `)
    await queryRunner.query(`CREATE TABLE "member_login_lock" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "app_key" character varying(32) NOT NULL, "credential_type" character varying(16) NOT NULL, "identifier" character varying(128) NOT NULL, "fail_count" integer NOT NULL DEFAULT '0', "locked_until" TIMESTAMP WITH TIME ZONE, "last_fail_at" TIMESTAMP WITH TIME ZONE, "update_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_17493558c489f256ffb15a35740" PRIMARY KEY ("id"))`)
    await queryRunner.query(`CREATE UNIQUE INDEX "uk_member_login_lock_dimension" ON "member_login_lock" ("app_key", "credential_type", "identifier") `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uk_member_login_lock_dimension"`)
    await queryRunner.query(`DROP TABLE "member_login_lock"`)
    await queryRunner.query(`DROP INDEX "public"."uk_member_credential_type_identifier"`)
    await queryRunner.query(`DROP INDEX "public"."idx_member_credential_member"`)
    await queryRunner.query(`DROP TABLE "member_credential"`)
    await queryRunner.query(`DROP INDEX "public"."idx_member_login_log_member"`)
    await queryRunner.query(`DROP INDEX "public"."idx_member_login_log_time"`)
    await queryRunner.query(`DROP INDEX "public"."idx_member_login_log_app_key"`)
    await queryRunner.query(`DROP TABLE "member_login_log"`)
    await queryRunner.query(`DROP INDEX "public"."uk_member_refresh_token_hash"`)
    await queryRunner.query(`DROP INDEX "public"."idx_member_refresh_token_member"`)
    await queryRunner.query(`DROP TABLE "member_refresh_token"`)
    await queryRunner.query(`DROP INDEX "public"."idx_member_status"`)
    await queryRunner.query(`DROP TABLE "member"`)
  }
}

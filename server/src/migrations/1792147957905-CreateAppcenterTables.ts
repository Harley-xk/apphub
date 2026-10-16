import { MigrationInterface, QueryRunner } from 'typeorm'

export class CreateAppcenterTables1792147957905 implements MigrationInterface {
  name = 'CreateAppcenterTables1792147957905'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "app_version" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "creator" uuid, "create_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updater" uuid, "update_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "app_id" uuid NOT NULL, "channel_id" uuid NOT NULL, "version" character varying(32) NOT NULL, "title" character varying(128) NOT NULL, "notes" text, "force_update" boolean NOT NULL DEFAULT false, "status" character varying(16) NOT NULL, "published_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_f2573b981a7eac664875e7483ac" PRIMARY KEY ("id"))`)
    await queryRunner.query(`CREATE INDEX "uk_app_version_scope" ON "app_version" ("app_id", "channel_id", "version") WHERE deleted_at IS NULL`)
    await queryRunner.query(`CREATE TABLE "app" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "creator" uuid, "create_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updater" uuid, "update_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "app_key" character varying(32) NOT NULL, "app_secret" character varying(64) NOT NULL, "name" character varying(64) NOT NULL, "app_type" character varying(32) array NOT NULL, "client_type" character varying(16) NOT NULL, "framework" character varying(16), "icon_url" character varying(512), "description" character varying(512), "status" character varying(16) NOT NULL, "sort" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_9478629fc093d229df09e560aea" PRIMARY KEY ("id"))`)
    await queryRunner.query(`CREATE INDEX "uk_app_app_key" ON "app" ("app_key") WHERE deleted_at IS NULL`)
    await queryRunner.query(`CREATE TABLE "app_package" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "creator" uuid, "create_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updater" uuid, "update_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "version_id" uuid NOT NULL, "platform" character varying(16) NOT NULL, "arch" character varying(16), "file_name" character varying(255) NOT NULL, "file_size" bigint NOT NULL, "sha256" character(64) NOT NULL, "sha512" character varying(96), "minisign_signature" text, "blockmap_object_key" character varying(512), "blockmap_sha512" character varying(96), "blockmap_file_size" bigint, "oss_object_key" character varying(512) NOT NULL, CONSTRAINT "PK_af82e69562c206c3e7249126b49" PRIMARY KEY ("id"))`)
    await queryRunner.query(`CREATE INDEX "uk_app_package_scope" ON "app_package" ("version_id", "platform", "arch") WHERE deleted_at IS NULL`)
    await queryRunner.query(`CREATE TABLE "app_channel" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "creator" uuid, "create_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updater" uuid, "update_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "app_id" uuid NOT NULL, "code" character varying(32) NOT NULL, "name" character varying(64) NOT NULL, "status" character varying(16) NOT NULL, "sort" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_592715f3612179ab978cb7a835a" PRIMARY KEY ("id"))`)
    await queryRunner.query(`CREATE INDEX "uk_app_channel_app_code" ON "app_channel" ("app_id", "code") WHERE deleted_at IS NULL`)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uk_app_channel_app_code"`)
    await queryRunner.query(`DROP TABLE "app_channel"`)
    await queryRunner.query(`DROP INDEX "public"."uk_app_package_scope"`)
    await queryRunner.query(`DROP TABLE "app_package"`)
    await queryRunner.query(`DROP INDEX "public"."uk_app_app_key"`)
    await queryRunner.query(`DROP TABLE "app"`)
    await queryRunner.query(`DROP INDEX "public"."uk_app_version_scope"`)
    await queryRunner.query(`DROP TABLE "app_version"`)
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKnowledgeUrlSource1780200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "knowledge_document_sourcetype_enum"
      ADD VALUE IF NOT EXISTS 'url'
    `);

    await queryRunner.query(`
      ALTER TABLE "knowledge_document"
      ADD COLUMN IF NOT EXISTS "sourceUrl" character varying(2048)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "knowledge_document"
      WHERE "sourceType" = 'url'
    `);

    await queryRunner.query(`
      ALTER TABLE "knowledge_document"
      DROP COLUMN IF EXISTS "sourceUrl"
    `);

    await queryRunner.query(`
      ALTER TABLE "knowledge_document"
      ALTER COLUMN "sourceType" TYPE text
      USING "sourceType"::text
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS "knowledge_document_sourcetype_enum"
    `);

    await queryRunner.query(`
      CREATE TYPE "knowledge_document_sourcetype_enum" AS ENUM ('upload')
    `);

    await queryRunner.query(`
      ALTER TABLE "knowledge_document"
      ALTER COLUMN "sourceType" TYPE "knowledge_document_sourcetype_enum"
      USING "sourceType"::"knowledge_document_sourcetype_enum"
    `);
  }
}

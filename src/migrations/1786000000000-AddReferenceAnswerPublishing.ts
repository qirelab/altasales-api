import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReferenceAnswerPublishing1786000000000
implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "knowledge_document_sourcetype_enum"
        ADD VALUE IF NOT EXISTS 'inline'
    `);

    await queryRunner.query(`
      ALTER TABLE "chatbot_reference_answer"
        ADD COLUMN IF NOT EXISTS "publishedDocumentId" uuid DEFAULT NULL
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_reference_answer_published_document'
        ) THEN
          ALTER TABLE "chatbot_reference_answer"
            ADD CONSTRAINT "FK_reference_answer_published_document"
            FOREIGN KEY ("publishedDocumentId")
            REFERENCES "knowledge_document"("id")
            ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS
        "IDX_reference_answer_published_document"
        ON "chatbot_reference_answer" ("publishedDocumentId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_reference_answer_published_document"
    `);
    await queryRunner.query(`
      ALTER TABLE "chatbot_reference_answer"
        DROP CONSTRAINT IF EXISTS "FK_reference_answer_published_document"
    `);
    await queryRunner.query(`
      ALTER TABLE "chatbot_reference_answer"
        DROP COLUMN IF EXISTS "publishedDocumentId"
    `);
    // Postgres does not support ALTER TYPE ... DROP VALUE. The inline enum
    // value stays; if a real removal is ever needed, rebuild the enum type.
  }
}

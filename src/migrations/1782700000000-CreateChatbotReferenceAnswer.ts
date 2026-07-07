import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateChatbotReferenceAnswer1782700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'chatbot_reference_answer_status_enum'
        ) THEN
          CREATE TYPE "chatbot_reference_answer_status_enum" AS ENUM ('active', 'archived');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chatbot_reference_answer" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "question" text NOT NULL,
        "answer" text NOT NULL,
        "topic" varchar(200) NOT NULL,
        "status" "chatbot_reference_answer_status_enum" NOT NULL DEFAULT 'active',
        "sourceDocumentId" uuid,
        "createdById" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chatbot_reference_answer" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_chatbot_reference_answer_status_createdAt"
        ON "chatbot_reference_answer" ("status", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_chatbot_reference_answer_topic"
        ON "chatbot_reference_answer" ("topic")
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_chatbot_reference_answer_source_document'
        ) THEN
          ALTER TABLE "chatbot_reference_answer"
            ADD CONSTRAINT "FK_chatbot_reference_answer_source_document"
            FOREIGN KEY ("sourceDocumentId") REFERENCES "knowledge_document"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_chatbot_reference_answer_created_by'
        ) THEN
          ALTER TABLE "chatbot_reference_answer"
            ADD CONSTRAINT "FK_chatbot_reference_answer_created_by"
            FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "chatbot_reference_answer"
        DROP CONSTRAINT IF EXISTS "FK_chatbot_reference_answer_created_by"
    `);
    await queryRunner.query(`
      ALTER TABLE "chatbot_reference_answer"
        DROP CONSTRAINT IF EXISTS "FK_chatbot_reference_answer_source_document"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_chatbot_reference_answer_topic"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_chatbot_reference_answer_status_createdAt"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chatbot_reference_answer"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "chatbot_reference_answer_status_enum"`);
  }
}

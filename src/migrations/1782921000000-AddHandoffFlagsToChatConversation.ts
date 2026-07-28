import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHandoffFlagsToChatConversation1782921000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'chat_handoff_trigger_enum'
        ) THEN
          CREATE TYPE "chat_handoff_trigger_enum" AS ENUM (
            'user_explicit_request',
            'rag_no_context',
            'rag_infra_error'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "chat_conversation"
        ADD COLUMN IF NOT EXISTS "needsHumanHandoff" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "handoffTrigger" "chat_handoff_trigger_enum" DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS "handoffRequestedAt" timestamptz DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "chat_conversation"
        DROP COLUMN IF EXISTS "handoffRequestedAt",
        DROP COLUMN IF EXISTS "handoffTrigger",
        DROP COLUMN IF EXISTS "needsHumanHandoff"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "chat_handoff_trigger_enum"
    `);
  }
}

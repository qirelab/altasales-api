import { MigrationInterface, QueryRunner } from 'typeorm';

// Renames the AI-chat storage from "conversation" to "session" semantics —
// multi-session per client + auto-title. The rename is table/column/type-only:
// no data is moved, so it's O(1) on prod.
export class RenameChatConversationToSession1785000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop the partial unique that limited each client to one platform
    //    conversation. Multi-session removes that constraint entirely.
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_platform_conversation_per_client"
    `);

    // 2. Rename core tables.
    await queryRunner.query(`
      DO $$ BEGIN
        IF to_regclass('public.chat_conversation') IS NOT NULL
          AND to_regclass('public.chat_session') IS NULL THEN
          ALTER TABLE "chat_conversation" RENAME TO "chat_session";
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF to_regclass('public.chat_conversation_participant') IS NOT NULL
          AND to_regclass('public.chat_session_participant') IS NULL THEN
          ALTER TABLE "chat_conversation_participant" RENAME TO "chat_session_participant";
        END IF;
      END $$;
    `);

    // 3. Rename FK column on messages + participants.
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'chat_message' AND column_name = 'conversationId')
          AND NOT EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'chat_message' AND column_name = 'sessionId') THEN
          ALTER TABLE "chat_message" RENAME COLUMN "conversationId" TO "sessionId";
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'chat_session_participant' AND column_name = 'conversationId')
          AND NOT EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'chat_session_participant' AND column_name = 'sessionId') THEN
          ALTER TABLE "chat_session_participant" RENAME COLUMN "conversationId" TO "sessionId";
        END IF;
      END $$;
    `);

    // 4. Rename the enum type.
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chat_conversation_type_enum')
          AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chat_session_type_enum') THEN
          ALTER TYPE "chat_conversation_type_enum" RENAME TO "chat_session_type_enum";
        END IF;
      END $$;
    `);

    // 5. Rename explicit constraints on the participant table.
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PK_chat_conversation_participant') THEN
          ALTER TABLE "chat_session_participant"
            RENAME CONSTRAINT "PK_chat_conversation_participant" TO "PK_chat_session_participant";
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UQ_chat_conversation_participant_conv_user') THEN
          ALTER TABLE "chat_session_participant"
            RENAME CONSTRAINT "UQ_chat_conversation_participant_conv_user"
            TO "UQ_chat_session_participant_session_user";
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_chat_conversation_participant_conversation') THEN
          ALTER TABLE "chat_session_participant"
            RENAME CONSTRAINT "FK_chat_conversation_participant_conversation"
            TO "FK_chat_session_participant_session";
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_chat_conversation_participant_user') THEN
          ALTER TABLE "chat_session_participant"
            RENAME CONSTRAINT "FK_chat_conversation_participant_user"
            TO "FK_chat_session_participant_user";
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_chat_conversation_orderId_order') THEN
          ALTER TABLE "chat_session"
            RENAME CONSTRAINT "FK_chat_conversation_orderId_order"
            TO "FK_chat_session_orderId_order";
        END IF;
      END $$;
    `);

    // 6. Rename indexes.
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'IDX_chat_conversation_participant_conversation') THEN
          ALTER INDEX "IDX_chat_conversation_participant_conversation" RENAME TO "IDX_chat_session_participant_session";
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'IDX_chat_conversation_participant_user') THEN
          ALTER INDEX "IDX_chat_conversation_participant_user" RENAME TO "IDX_chat_session_participant_user";
        END IF;
      END $$;
    `);

    // 7. Per-session title, set by ChatService from the client's first message.
    await queryRunner.query(`
      ALTER TABLE "chat_session"
        ADD COLUMN IF NOT EXISTS "title" VARCHAR(120)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the new title column; reverse the renames.
    await queryRunner.query(`
      ALTER TABLE "chat_session" DROP COLUMN IF EXISTS "title"
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'IDX_chat_session_participant_user') THEN
          ALTER INDEX "IDX_chat_session_participant_user" RENAME TO "IDX_chat_conversation_participant_user";
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'IDX_chat_session_participant_session') THEN
          ALTER INDEX "IDX_chat_session_participant_session" RENAME TO "IDX_chat_conversation_participant_conversation";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_chat_session_orderId_order') THEN
          ALTER TABLE "chat_session"
            RENAME CONSTRAINT "FK_chat_session_orderId_order"
            TO "FK_chat_conversation_orderId_order";
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_chat_session_participant_user') THEN
          ALTER TABLE "chat_session_participant"
            RENAME CONSTRAINT "FK_chat_session_participant_user"
            TO "FK_chat_conversation_participant_user";
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_chat_session_participant_session') THEN
          ALTER TABLE "chat_session_participant"
            RENAME CONSTRAINT "FK_chat_session_participant_session"
            TO "FK_chat_conversation_participant_conversation";
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UQ_chat_session_participant_session_user') THEN
          ALTER TABLE "chat_session_participant"
            RENAME CONSTRAINT "UQ_chat_session_participant_session_user"
            TO "UQ_chat_conversation_participant_conv_user";
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PK_chat_session_participant') THEN
          ALTER TABLE "chat_session_participant"
            RENAME CONSTRAINT "PK_chat_session_participant" TO "PK_chat_conversation_participant";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chat_session_type_enum')
          AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chat_conversation_type_enum') THEN
          ALTER TYPE "chat_session_type_enum" RENAME TO "chat_conversation_type_enum";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'chat_session_participant' AND column_name = 'sessionId')
          AND NOT EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'chat_session_participant' AND column_name = 'conversationId') THEN
          ALTER TABLE "chat_session_participant" RENAME COLUMN "sessionId" TO "conversationId";
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'chat_message' AND column_name = 'sessionId')
          AND NOT EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'chat_message' AND column_name = 'conversationId') THEN
          ALTER TABLE "chat_message" RENAME COLUMN "sessionId" TO "conversationId";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF to_regclass('public.chat_session_participant') IS NOT NULL
          AND to_regclass('public.chat_conversation_participant') IS NULL THEN
          ALTER TABLE "chat_session_participant" RENAME TO "chat_conversation_participant";
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF to_regclass('public.chat_session') IS NOT NULL
          AND to_regclass('public.chat_conversation') IS NULL THEN
          ALTER TABLE "chat_session" RENAME TO "chat_conversation";
        END IF;
      END $$;
    `);

    // Restore the partial unique index that limited each client to one platform
    // conversation (multi-session was the whole point of this migration; down()
    // just re-installs the old constraint for completeness).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_platform_conversation_per_client"
        ON "chat_conversation" ("participantOneId", "participantTwoId")
        WHERE "type" = 'platform' AND "orderId" IS NULL
    `);
  }
}

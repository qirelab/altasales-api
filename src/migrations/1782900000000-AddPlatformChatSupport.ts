import { MigrationInterface, QueryRunner } from 'typeorm';

const AI_SYSTEM_USER_ID = '00000000-0000-0000-0000-00000000a1a1';
const AI_SYSTEM_USER_EMAIL = 'ai@altasales.internal';
const AI_SYSTEM_USER_NAME = 'AI-консультант AltaSales';

export class AddPlatformChatSupport1782900000000 implements MigrationInterface {
  // Postgres refuses to use a value added to an enum via ALTER TYPE ... ADD
  // VALUE inside the same transaction that added it — the INSERT of the AI
  // system-user (role = 'system_ai') below would otherwise fail with
  // "unsafe use of new value 'system_ai' of enum type user_role_enum".
  // Running the whole migration outside a transaction sidesteps this. All
  // DDL statements below are already guarded with IF NOT EXISTS / ON
  // CONFLICT DO NOTHING, so partial re-runs stay safe.
  public transaction = false as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new UserRole value 'system_ai'. Postgres does not allow adding enum
    // values in a transaction started by TypeORM in older versions, but
    // ALTER TYPE ... ADD VALUE IF NOT EXISTS is safe here since TypeORM opens
    // migrations with a commit-on-run wrapper.
    await queryRunner.query(
      `ALTER TYPE "user_role_enum" ADD VALUE IF NOT EXISTS 'system_ai'`,
    );

    // chat_conversation.type enum + column with default 'expert' (backfills
    // existing rows automatically).
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'chat_conversation_type_enum'
        ) THEN
          CREATE TYPE "chat_conversation_type_enum" AS ENUM ('expert', 'platform');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "chat_conversation"
        ADD COLUMN IF NOT EXISTS "type" "chat_conversation_type_enum" NOT NULL DEFAULT 'expert'
    `);

    // chat_message.isAiGenerated boolean with default false.
    await queryRunner.query(`
      ALTER TABLE "chat_message"
        ADD COLUMN IF NOT EXISTS "isAiGenerated" boolean NOT NULL DEFAULT false
    `);

    // chat_conversation_participant join table.
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'chat_participant_role_enum'
        ) THEN
          CREATE TYPE "chat_participant_role_enum" AS ENUM ('client', 'ai', 'expert', 'operator');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chat_conversation_participant" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "conversationId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "role" "chat_participant_role_enum" NOT NULL,
        "addedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_conversation_participant" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_chat_conversation_participant_conv_user"
          UNIQUE ("conversationId", "userId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_chat_conversation_participant_conversation"
        ON "chat_conversation_participant" ("conversationId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_chat_conversation_participant_user"
        ON "chat_conversation_participant" ("userId")
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_chat_conversation_participant_conversation'
        ) THEN
          ALTER TABLE "chat_conversation_participant"
            ADD CONSTRAINT "FK_chat_conversation_participant_conversation"
            FOREIGN KEY ("conversationId") REFERENCES "chat_conversation"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_chat_conversation_participant_user'
        ) THEN
          ALTER TABLE "chat_conversation_participant"
            ADD CONSTRAINT "FK_chat_conversation_participant_user"
            FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    // Seed the AI system user with a fixed UUID. ON CONFLICT DO NOTHING makes
    // the migration idempotent across environments that already have the row.
    await queryRunner.query(
      `
      INSERT INTO "user" (
        "id", "name", "lastName", "email", "phoneNumber",
        "firebaseUid", "balance", "role"
      )
      VALUES (
        $1, $2, '', $3, '',
        NULL, 0, 'system_ai'
      )
      ON CONFLICT ("id") DO NOTHING
    `,
      [AI_SYSTEM_USER_ID, AI_SYSTEM_USER_NAME, AI_SYSTEM_USER_EMAIL],
    );

    // Backfill participants for existing expert-type conversations so that
    // membership queries work for every historical chat, not only new ones.
    // We resolve each participant's role from user.role so the semantic tag
    // is truthful (expert / admin operator / client), not just "client".
    await queryRunner.query(`
      INSERT INTO "chat_conversation_participant" ("conversationId", "userId", "role")
      SELECT c."id", u."id",
        CASE
          WHEN u."role"::text = 'expert' THEN 'expert'::chat_participant_role_enum
          WHEN u."role"::text = 'admin' THEN 'operator'::chat_participant_role_enum
          WHEN u."role"::text = 'system_ai' THEN 'ai'::chat_participant_role_enum
          ELSE 'client'::chat_participant_role_enum
        END
      FROM "chat_conversation" c
      JOIN "user" u ON u."id" = c."participantOneId"
      WHERE NOT EXISTS (
        SELECT 1 FROM "chat_conversation_participant" p
        WHERE p."conversationId" = c."id" AND p."userId" = c."participantOneId"
      )
    `);
    await queryRunner.query(`
      INSERT INTO "chat_conversation_participant" ("conversationId", "userId", "role")
      SELECT c."id", u."id",
        CASE
          WHEN u."role"::text = 'expert' THEN 'expert'::chat_participant_role_enum
          WHEN u."role"::text = 'admin' THEN 'operator'::chat_participant_role_enum
          WHEN u."role"::text = 'system_ai' THEN 'ai'::chat_participant_role_enum
          ELSE 'client'::chat_participant_role_enum
        END
      FROM "chat_conversation" c
      JOIN "user" u ON u."id" = c."participantTwoId"
      WHERE NOT EXISTS (
        SELECT 1 FROM "chat_conversation_participant" p
        WHERE p."conversationId" = c."id" AND p."userId" = c."participantTwoId"
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chat_conversation_participant"
        DROP CONSTRAINT IF EXISTS "FK_chat_conversation_participant_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_conversation_participant"
        DROP CONSTRAINT IF EXISTS "FK_chat_conversation_participant_conversation"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_chat_conversation_participant_user"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_chat_conversation_participant_conversation"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "chat_conversation_participant"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "chat_participant_role_enum"`);

    await queryRunner.query(
      `ALTER TABLE "chat_message" DROP COLUMN IF EXISTS "isAiGenerated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_conversation" DROP COLUMN IF EXISTS "type"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "chat_conversation_type_enum"`,
    );

    await queryRunner.query(`DELETE FROM "user" WHERE "id" = $1`, [
      AI_SYSTEM_USER_ID,
    ]);

    // We intentionally do NOT remove 'system_ai' from the user_role_enum:
    // Postgres does not support removing enum values without recreating the
    // type, and leaving the value is harmless.
  }
}

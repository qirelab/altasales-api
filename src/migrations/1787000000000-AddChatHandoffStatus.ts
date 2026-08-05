import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatHandoffStatus1787000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'chat_handoff_status_enum'
        ) THEN
          CREATE TYPE "chat_handoff_status_enum" AS ENUM (
            'awaiting',
            'in_progress',
            'resolved'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "chat_session"
        ADD COLUMN IF NOT EXISTS "handoffStatus" "chat_handoff_status_enum" DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS "assignedOperatorId" uuid DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS "handoffClaimedAt" timestamptz DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS "handoffResolvedAt" timestamptz DEFAULT NULL
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_chat_session_assigned_operator'
        ) THEN
          ALTER TABLE "chat_session"
            ADD CONSTRAINT "FK_chat_session_assigned_operator"
            FOREIGN KEY ("assignedOperatorId")
            REFERENCES "user"("id")
            ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS
        "IDX_chat_session_handoff_status_updated"
        ON "chat_session" ("handoffStatus", "updatedAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS
        "IDX_chat_session_assigned_operator"
        ON "chat_session" ("assignedOperatorId")
    `);

    // Backfill: rows that already have needsHumanHandoff=true should be
    // marked as 'awaiting' so they show up in the operator inbox after
    // deployment.
    await queryRunner.query(`
      UPDATE "chat_session"
      SET "handoffStatus" = 'awaiting'
      WHERE "needsHumanHandoff" = true AND "handoffStatus" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_chat_session_assigned_operator"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_chat_session_handoff_status_updated"
    `);
    await queryRunner.query(`
      ALTER TABLE "chat_session"
        DROP CONSTRAINT IF EXISTS "FK_chat_session_assigned_operator"
    `);
    await queryRunner.query(`
      ALTER TABLE "chat_session"
        DROP COLUMN IF EXISTS "handoffResolvedAt",
        DROP COLUMN IF EXISTS "handoffClaimedAt",
        DROP COLUMN IF EXISTS "assignedOperatorId",
        DROP COLUMN IF EXISTS "handoffStatus"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "chat_handoff_status_enum"
    `);
  }
}

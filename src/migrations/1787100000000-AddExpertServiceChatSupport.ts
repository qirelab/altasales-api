import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Expert service chats: inbox/timeout indexes + backfill sessions for already
 * paid orders that have an assigned expert executor.
 */
export class AddExpertServiceChatSupport1787100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_chat_session_expert_handoff"
        ON "chat_session" ("type", "handoffStatus", "updatedAt")
        WHERE "type" = 'expert'
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_chat_session_handoff_timeout"
        ON "chat_session" ("handoffStatus", "handoffRequestedAt")
        WHERE "handoffStatus" IN ('awaiting', 'in_progress')
          AND "handoffRequestedAt" IS NOT NULL
    `);

    // Backfill: create expert sessions for paid orders with an executor.
    // participantOne/Two = sorted(client, expert); AI is participants-only.
    await queryRunner.query(`
      INSERT INTO "chat_session" (
        "id",
        "type",
        "participantOneId",
        "participantTwoId",
        "orderId",
        "title",
        "needsHumanHandoff",
        "createdAt",
        "updatedAt"
      )
      SELECT
        gen_random_uuid(),
        'expert',
        LEAST(o."userId", item."executorUserId"),
        GREATEST(o."userId", item."executorUserId"),
        o."id",
        COALESCE(s."name", pkg."name", ep."name"),
        false,
        NOW(),
        NOW()
      FROM "order" o
      INNER JOIN "order_item" item ON item."orderId" = o."id"
      LEFT JOIN "service" s ON s."id" = item."serviceId"
      LEFT JOIN "service_package" pkg ON pkg."id" = item."packageId"
      LEFT JOIN "expert_position" ep ON ep."id" = item."expertPositionId"
      WHERE item."executorUserId" IS NOT NULL
        AND item."executorUserId" <> o."userId"
        AND o."status" NOT IN ('pending_payment', 'cancelled')
        AND NOT EXISTS (
          SELECT 1 FROM "chat_session" cs
          WHERE cs."type" = 'expert'
            AND cs."orderId" = o."id"
            AND cs."participantOneId" = LEAST(o."userId", item."executorUserId")
            AND cs."participantTwoId" = GREATEST(o."userId", item."executorUserId")
        )
    `);

    // Legacy contractor path (service.type = Подрядчик)
    await queryRunner.query(`
      INSERT INTO "chat_session" (
        "id",
        "type",
        "participantOneId",
        "participantTwoId",
        "orderId",
        "title",
        "needsHumanHandoff",
        "createdAt",
        "updatedAt"
      )
      SELECT
        gen_random_uuid(),
        'expert',
        LEAST(o."userId", s."userId"),
        GREATEST(o."userId", s."userId"),
        o."id",
        s."name",
        false,
        NOW(),
        NOW()
      FROM "order" o
      INNER JOIN "order_item" item ON item."orderId" = o."id"
      INNER JOIN "service" s ON s."id" = item."serviceId"
      WHERE item."executorUserId" IS NULL
        AND s."type" = 'Подрядчик'
        AND s."userId" IS NOT NULL
        AND s."userId" <> o."userId"
        AND o."status" NOT IN ('pending_payment', 'cancelled')
        AND NOT EXISTS (
          SELECT 1 FROM "chat_session" cs
          WHERE cs."type" = 'expert'
            AND cs."orderId" = o."id"
            AND cs."participantOneId" = LEAST(o."userId", s."userId")
            AND cs."participantTwoId" = GREATEST(o."userId", s."userId")
        )
    `);

    // Participants for backfilled (and any expert sessions missing AI/client/expert).
    await queryRunner.query(`
      INSERT INTO "chat_session_participant" ("sessionId", "userId", "role", "addedAt")
      SELECT cs."id", cs."participantOneId",
        CASE WHEN cs."participantOneId" = o."userId" THEN 'client'::chat_participant_role_enum
             ELSE 'expert'::chat_participant_role_enum END,
        NOW()
      FROM "chat_session" cs
      INNER JOIN "order" o ON o."id" = cs."orderId"
      WHERE cs."type" = 'expert'
        AND cs."orderId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "chat_session_participant" p
          WHERE p."sessionId" = cs."id" AND p."userId" = cs."participantOneId"
        )
    `);

    await queryRunner.query(`
      INSERT INTO "chat_session_participant" ("sessionId", "userId", "role", "addedAt")
      SELECT cs."id", cs."participantTwoId",
        CASE WHEN cs."participantTwoId" = o."userId" THEN 'client'::chat_participant_role_enum
             ELSE 'expert'::chat_participant_role_enum END,
        NOW()
      FROM "chat_session" cs
      INNER JOIN "order" o ON o."id" = cs."orderId"
      WHERE cs."type" = 'expert'
        AND cs."orderId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "chat_session_participant" p
          WHERE p."sessionId" = cs."id" AND p."userId" = cs."participantTwoId"
        )
    `);

    await queryRunner.query(`
      INSERT INTO "chat_session_participant" ("sessionId", "userId", "role", "addedAt")
      SELECT cs."id", '00000000-0000-0000-0000-00000000a1a1',
        'ai'::chat_participant_role_enum,
        NOW()
      FROM "chat_session" cs
      WHERE cs."type" = 'expert'
        AND cs."orderId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "chat_session_participant" p
          WHERE p."sessionId" = cs."id"
            AND p."userId" = '00000000-0000-0000-0000-00000000a1a1'
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_chat_session_handoff_timeout"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_chat_session_expert_handoff"
    `);
  }
}

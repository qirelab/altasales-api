import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Idempotent backfill for expert-service chats on purchases that existed
 * before the feature (or before migration 178710). Covers:
 * - executorUserId path
 * - legacy Contractor service.userId path
 * Missing participants (client / expert / AI) on existing expert sessions.
 */
export class BackfillLegacyExpertServiceChats1787110000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Executor-based purchases
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

    // Legacy contractor purchases (service.type = Подрядчик, service.userId = expert)
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

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Data backfill is not reversed — sessions stay.
  }
}

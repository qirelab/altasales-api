import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforcePlatformChatUniqueness1782910000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Guard against concurrent openPlatformConversation races. The existing
    // UQ_chat_conversation_participants_order constraint is not NULL-safe:
    // PostgreSQL treats NULL values in unique keys as distinct, so two
    // parallel platform opens (both with orderId = NULL) each pass the
    // check-then-insert and end up as duplicate conversations plus duplicate
    // welcome messages. The partial index below enforces exactly one
    // platform conversation per client irrespective of NULL semantics, and
    // ChatService.findOrCreatePlatformConversation converts the resulting
    // 23505 into the "return the row the winner wrote" recovery path.
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_platform_conversation_per_client"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_platform_conversation_per_client"
        ON "chat_conversation" ("participantOneId", "participantTwoId")
        WHERE "type" = 'platform' AND "orderId" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_platform_conversation_per_client"
    `);
  }
}

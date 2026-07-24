import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a per-participant read cursor to `chat_conversation_participant`.
 * Required for group platform-chats (client + AI + expert(s)): a message-level
 * `isRead` flag can only track ONE reader, so if the expert opens the chat
 * first the client's unread counter drops to zero even though they never
 * read the AI's reply.
 */
export class AddChatParticipantLastReadAt1782920000000
implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "chat_conversation_participant"
      ADD COLUMN IF NOT EXISTS "lastReadAt" timestamptz NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "chat_conversation_participant"
      DROP COLUMN IF EXISTS "lastReadAt"
    `);
  }
}

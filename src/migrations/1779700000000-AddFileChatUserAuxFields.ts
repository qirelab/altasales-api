import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFileChatUserAuxFields1779700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // chat_conversation: orderId column + FK + unique (participantOneId, participantTwoId, orderId)
    await queryRunner.query(`
      ALTER TABLE "chat_conversation"
      ADD COLUMN IF NOT EXISTS "orderId" uuid NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_chat_conversation_orderId_order'
        ) THEN
          ALTER TABLE "chat_conversation"
            ADD CONSTRAINT "FK_chat_conversation_orderId_order"
            FOREIGN KEY ("orderId") REFERENCES "order"("id")
            ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      DECLARE con_name text;
      BEGIN
        SELECT tc.constraint_name
        INTO con_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'chat_conversation'
          AND tc.constraint_type = 'UNIQUE'
        GROUP BY tc.constraint_name
<<<<<<< HEAD
        HAVING array_agg(kcu.column_name::text ORDER BY kcu.ordinal_position)
=======
        HAVING array_agg(kcu.column_name ORDER BY kcu.ordinal_position)
>>>>>>> f8f33ce3a1cc83f3c25cff63b854e838030bc6a0
          = ARRAY['participantOneId', 'participantTwoId'];

        IF con_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE "chat_conversation" DROP CONSTRAINT %I', con_name);
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
          WHERE tc.table_schema = 'public'
            AND tc.table_name = 'chat_conversation'
            AND tc.constraint_type = 'UNIQUE'
          GROUP BY tc.constraint_name
<<<<<<< HEAD
          HAVING array_agg(kcu.column_name::text ORDER BY kcu.ordinal_position)
=======
          HAVING array_agg(kcu.column_name ORDER BY kcu.ordinal_position)
>>>>>>> f8f33ce3a1cc83f3c25cff63b854e838030bc6a0
            = ARRAY['participantOneId', 'participantTwoId', 'orderId']
        ) THEN
          ALTER TABLE "chat_conversation"
            ADD CONSTRAINT "UQ_chat_conversation_participants_order"
            UNIQUE ("participantOneId", "participantTwoId", "orderId");
        END IF;
      END $$;
    `);

    // file_entity: ropDocumentId, orderItemId (+ FK to order_item), source enum
    await queryRunner.query(`
      ALTER TABLE "file_entity"
      ADD COLUMN IF NOT EXISTS "ropDocumentId" varchar NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "file_entity"
      ADD COLUMN IF NOT EXISTS "orderItemId" uuid NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_file_entity_orderItemId_order_item'
        ) THEN
          ALTER TABLE "file_entity"
            ADD CONSTRAINT "FK_file_entity_orderItemId_order_item"
            FOREIGN KEY ("orderItemId") REFERENCES "order_item"("id")
            ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'file_entity_source_enum') THEN
          CREATE TYPE "file_entity_source_enum" AS ENUM ('client', 'admin');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "file_entity"
      ADD COLUMN IF NOT EXISTS "source" "file_entity_source_enum" NOT NULL DEFAULT 'client'
    `);

    // user: ropProjectId
    await queryRunner.query(`
      ALTER TABLE "user"
      ADD COLUMN IF NOT EXISTS "ropProjectId" varchar NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
      DROP COLUMN IF EXISTS "ropProjectId"
    `);

    await queryRunner.query(`
      ALTER TABLE "file_entity"
      DROP CONSTRAINT IF EXISTS "FK_file_entity_orderItemId_order_item"
    `);

    await queryRunner.query(`
      ALTER TABLE "file_entity"
      DROP COLUMN IF EXISTS "source"
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS "file_entity_source_enum"
    `);

    await queryRunner.query(`
      ALTER TABLE "file_entity"
      DROP COLUMN IF EXISTS "orderItemId"
    `);

    await queryRunner.query(`
      ALTER TABLE "file_entity"
      DROP COLUMN IF EXISTS "ropDocumentId"
    `);

    await queryRunner.query(`
      ALTER TABLE "chat_conversation"
      DROP CONSTRAINT IF EXISTS "UQ_chat_conversation_participants_order"
    `);

    await queryRunner.query(`
      ALTER TABLE "chat_conversation"
      DROP CONSTRAINT IF EXISTS "FK_chat_conversation_orderId_order"
    `);

    await queryRunner.query(`
      ALTER TABLE "chat_conversation"
      DROP COLUMN IF EXISTS "orderId"
    `);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFeedbackTable1781300000000 implements MigrationInterface {
  name = 'CreateFeedbackTable1781300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'feedback_status_enum') THEN
          CREATE TYPE "feedback_status_enum" AS ENUM ('new', 'reviewed');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "feedback" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "message" text NOT NULL,
        "rating" integer,
        "status" "feedback_status_enum" NOT NULL DEFAULT 'new',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_feedback" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_feedback_userId') THEN
          ALTER TABLE "feedback"
          ADD CONSTRAINT "FK_feedback_userId"
          FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_feedback_userId" ON "feedback" ("userId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_feedback_status" ON "feedback" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_feedback_createdAt" ON "feedback" ("createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_feedback_createdAt"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_feedback_status"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_feedback_userId"');
    await queryRunner.query(`
      ALTER TABLE "feedback" DROP CONSTRAINT IF EXISTS "FK_feedback_userId"
    `);
    await queryRunner.query('DROP TABLE IF EXISTS "feedback"');
    await queryRunner.query('DROP TYPE IF EXISTS "feedback_status_enum"');
  }
}

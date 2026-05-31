import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTranscriptionJobs1780300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp"
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transcription_job_status_enum') THEN
          CREATE TYPE "transcription_job_status_enum" AS ENUM ('queued', 'running', 'succeeded', 'failed');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "transcription_job" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "status" "transcription_job_status_enum" NOT NULL DEFAULT 'queued',
        "originalFileName" character varying(255) NOT NULL,
        "mimeType" character varying(150) NOT NULL,
        "size" integer NOT NULL,
        "language" character varying(20) NOT NULL,
        "provider" character varying(50) NOT NULL DEFAULT 'yandex_speechkit',
        "externalOperationId" character varying(255),
        "objectStorageKey" character varying(512),
        "text" text,
        "segments" jsonb NOT NULL DEFAULT '[]',
        "errorCode" character varying(100),
        "safeErrorMessage" character varying(255),
        "startedAt" timestamp with time zone,
        "finishedAt" timestamp with time zone,
        "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
        "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "PK_transcription_job_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_transcription_job_userId_user"
          FOREIGN KEY ("userId")
          REFERENCES "user"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_transcription_job_userId_createdAt"
      ON "transcription_job" ("userId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_transcription_job_status_createdAt"
      ON "transcription_job" ("status", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_transcription_job_status_createdAt"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_transcription_job_userId_createdAt"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "transcription_job"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "transcription_job_status_enum"
    `);
  }
}

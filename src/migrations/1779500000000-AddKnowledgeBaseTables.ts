import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKnowledgeBaseTables1779500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp"
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'knowledge_document_purpose_enum') THEN
          CREATE TYPE "knowledge_document_purpose_enum" AS ENUM ('recommendations', 'qa_chatbot');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'knowledge_document_sourcetype_enum') THEN
          CREATE TYPE "knowledge_document_sourcetype_enum" AS ENUM ('upload');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'knowledge_document_status_enum') THEN
          CREATE TYPE "knowledge_document_status_enum" AS ENUM ('pending', 'extracting', 'chunking', 'embedding', 'indexing', 'indexed', 'failed');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'knowledge_index_job_status_enum') THEN
          CREATE TYPE "knowledge_index_job_status_enum" AS ENUM ('pending', 'running', 'succeeded', 'failed');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'knowledge_index_job_stage_enum') THEN
          CREATE TYPE "knowledge_index_job_stage_enum" AS ENUM ('pending', 'extracting', 'chunking', 'embedding', 'indexing', 'indexed', 'failed');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "knowledge_document" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying(255),
        "purpose" "knowledge_document_purpose_enum" NOT NULL,
        "sourceType" "knowledge_document_sourcetype_enum" NOT NULL,
        "originalFileName" character varying(255) NOT NULL,
        "mimeType" character varying(150) NOT NULL,
        "size" integer NOT NULL,
        "status" "knowledge_document_status_enum" NOT NULL DEFAULT 'pending',
        "errorCode" character varying(100),
        "safeErrorMessage" character varying(255),
        "chunksCount" integer NOT NULL DEFAULT 0,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_knowledge_document_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "knowledge_chunk" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "documentId" uuid NOT NULL,
        "chunkIndex" integer NOT NULL,
        "text" text NOT NULL,
        "charLength" integer NOT NULL,
        "tokenEstimate" integer,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_knowledge_chunk_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_knowledge_chunk_documentId_knowledge_document"
          FOREIGN KEY ("documentId")
          REFERENCES "knowledge_document"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "knowledge_index_job" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "documentId" uuid NOT NULL,
        "status" "knowledge_index_job_status_enum" NOT NULL DEFAULT 'pending',
        "stage" "knowledge_index_job_stage_enum" NOT NULL DEFAULT 'pending',
        "errorCode" character varying(100),
        "safeErrorMessage" character varying(255),
        "chunksTotal" integer NOT NULL DEFAULT 0,
        "chunksEmbedded" integer NOT NULL DEFAULT 0,
        "startedAt" timestamp,
        "finishedAt" timestamp,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_knowledge_index_job_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_knowledge_index_job_documentId_knowledge_document"
          FOREIGN KEY ("documentId")
          REFERENCES "knowledge_document"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_knowledge_document_purpose_status_createdAt"
      ON "knowledge_document" ("purpose", "status", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_knowledge_chunk_documentId_chunkIndex"
      ON "knowledge_chunk" ("documentId", "chunkIndex")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_knowledge_index_job_documentId_status"
      ON "knowledge_index_job" ("documentId", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_knowledge_index_job_documentId_status"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_knowledge_chunk_documentId_chunkIndex"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_knowledge_document_purpose_status_createdAt"
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS "knowledge_index_job"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "knowledge_chunk"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "knowledge_document"
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS "knowledge_index_job_stage_enum"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "knowledge_index_job_status_enum"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "knowledge_document_status_enum"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "knowledge_document_sourcetype_enum"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "knowledge_document_purpose_enum"
    `);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceSingleExpertGroupMembership1781220000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH ranked AS (
        SELECT
          m.id,
          ROW_NUMBER() OVER (
            PARTITION BY m."userId"
            ORDER BY m."createdAt" ASC, m.id ASC
          ) AS rn
        FROM "expert_position_member" m
        WHERE m."deletedAt" IS NULL
      )
      UPDATE "expert_position_member" m
      SET "deletedAt" = NOW()
      FROM ranked r
      WHERE m.id = r.id
        AND r.rn > 1
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_expert_position_member_user_active"
      ON "expert_position_member" ("userId")
      WHERE "deletedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_expert_position_member_user_active"
    `);
  }
}

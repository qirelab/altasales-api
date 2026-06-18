import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExpertProfileTable1781500000000 implements MigrationInterface {
  name = 'CreateExpertProfileTable1781500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "expert_profile" (
        "userId" uuid NOT NULL,
        "displayName" character varying NULL,
        "description" text NULL,
        "skills" json NOT NULL DEFAULT '[]',
        "image" character varying NULL,
        "experienceYears" integer NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_expert_profile_userId" PRIMARY KEY ("userId")
      )
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_expert_profile_user') THEN
          ALTER TABLE "expert_profile"
          ADD CONSTRAINT "FK_expert_profile_user"
          FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      INSERT INTO "expert_profile" ("userId", "displayName", "description", "skills", "image", "experienceYears")
      SELECT
        s."userId",
        s.name,
        s.description,
        COALESCE(s.skills, '[]'::json),
        s.image,
        s."contractorExperienceYears"
      FROM service s
      INNER JOIN "user" u ON u.id = s."userId"
      WHERE s.type = 'Подрядчик'
        AND s."deletedAt" IS NULL
        AND u.role = 'expert'
      ON CONFLICT ("userId") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "expert_profile" ("userId", "experienceYears")
      SELECT u.id, u."experienceYears"
      FROM "user" u
      WHERE u.role = 'expert'
        AND u."experienceYears" IS NOT NULL
      ON CONFLICT ("userId") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "expert_profile" DROP CONSTRAINT IF EXISTS "FK_expert_profile_user"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "expert_profile"`);
  }
}

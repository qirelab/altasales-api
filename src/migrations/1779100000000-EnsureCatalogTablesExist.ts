import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catch-up migration: creates catalog tables that were originally created on
 * dev/staging via `synchronize: true` but never reached prod through a formal
 * migration (Category, FAQ, ServicePackage, package_services join table,
 * Recommendation), plus the new service columns introduced together with
 * the Category/Package model. Everything is wrapped in `IF NOT EXISTS` guards
 * so envs that already have the tables/columns get a no-op.
 */
export class EnsureCatalogTablesExist1779100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // uuid_generate_v4()
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    // category
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "category" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar(120) NOT NULL,
        "slug" varchar(120),
        "description" text,
        CONSTRAINT "PK_category_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_category_name" UNIQUE ("name")
      )
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'UQ_category_slug'
        ) THEN
          ALTER TABLE "category"
            ADD CONSTRAINT "UQ_category_slug" UNIQUE ("slug");
        END IF;
      END $$;
    `);

    // faq
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "faq" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "question" text NOT NULL,
        "answer" text NOT NULL,
        "categoryId" uuid NOT NULL,
        CONSTRAINT "PK_faq_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_faq_category"
          FOREIGN KEY ("categoryId")
          REFERENCES "category"("id")
          ON DELETE CASCADE
      )
    `);

    // service: add catalog/admin columns introduced alongside Category/Package
    await queryRunner.query(`
      ALTER TABLE "service"
      ADD COLUMN IF NOT EXISTS "categoryId" uuid NULL
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_service_category'
        ) THEN
          ALTER TABLE "service"
            ADD CONSTRAINT "FK_service_category"
            FOREIGN KEY ("categoryId") REFERENCES "category"("id")
            ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "service"
      ADD COLUMN IF NOT EXISTS "image" varchar NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "service"
      ADD COLUMN IF NOT EXISTS "skills" json NOT NULL DEFAULT '[]'
    `);
    await queryRunner.query(`
      ALTER TABLE "service"
      ADD COLUMN IF NOT EXISTS "contractorRatePerHour" decimal(12,2) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "service"
      ADD COLUMN IF NOT EXISTS "contractorExperienceYears" int NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "service"
      ADD COLUMN IF NOT EXISTS "userId" uuid NULL
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_service_user'
        ) THEN
          ALTER TABLE "service"
            ADD CONSTRAINT "FK_service_user"
            FOREIGN KEY ("userId") REFERENCES "user"("id")
            ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "service"
      ADD COLUMN IF NOT EXISTS "contentSections" json NOT NULL DEFAULT '[]'
    `);

    // service_package
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "service_package" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar(255) NOT NULL,
        "description" text NOT NULL,
        "tags" json NOT NULL DEFAULT '[]',
        "packageType" varchar(50) NOT NULL,
        "price" decimal(12,2) NOT NULL DEFAULT 0,
        "categoryId" uuid NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_service_package_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_service_package_category"
          FOREIGN KEY ("categoryId")
          REFERENCES "category"("id")
          ON DELETE SET NULL
      )
    `);

    // package_services (join table for ManyToMany Package <-> Service)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "package_services" (
        "packageId" uuid NOT NULL,
        "serviceId" uuid NOT NULL,
        CONSTRAINT "PK_package_services" PRIMARY KEY ("packageId", "serviceId"),
        CONSTRAINT "FK_package_services_package"
          FOREIGN KEY ("packageId")
          REFERENCES "service_package"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_package_services_service"
          FOREIGN KEY ("serviceId")
          REFERENCES "service"("id")
          ON DELETE CASCADE
      )
    `);

    // recommendation
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "recommendation" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "serviceId" uuid NOT NULL,
        "orderId" uuid NULL,
        "status" varchar(20) NOT NULL DEFAULT 'recommended',
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_recommendation_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_recommendation_user"
          FOREIGN KEY ("userId")
          REFERENCES "user"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_recommendation_service"
          FOREIGN KEY ("serviceId")
          REFERENCES "service"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_recommendation_order"
          FOREIGN KEY ("orderId")
          REFERENCES "order"("id")
          ON DELETE SET NULL
      )
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Intentionally no-op: this is a catch-up migration that aligns prod with
    // dev/staging. Rolling it back would drop catalog tables together with
    // their data, which is never what we want here.
  }
}

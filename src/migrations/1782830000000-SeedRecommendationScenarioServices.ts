import { MigrationInterface, QueryRunner } from 'typeorm';
import { ServiceType } from '../services/entities/service-type.enum';

const scenarioServices = [
  {
    id: '8b8508c1-9e8b-44c7-a7b7-639bf0afe8a6',
    name: 'Аналитический отчёт по отказным сделкам',
    categorySlug: 'quality-control',
    price: 5000,
    description:
      'Разбор причин отказа клиентов и точек потери сделок на этапах воронки.',
    skills: ['контроль', 'отказы', 'аналитика'],
  },
  {
    id: 'cfc96602-9c0b-45af-809b-725b0d198993',
    name: 'Эксперт РОП: консультация',
    categorySlug: 'experts',
    price: 0,
    description:
      'Экспертная консультация по роли РОП, управлению командой и развитию действующего отдела продаж.',
    skills: ['роп', 'консультация', 'управление продажами'],
  },
] as const;

export class SeedRecommendationScenarioServices1782830000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const service of scenarioServices) {
      const [category] = await queryRunner.query(
        'SELECT "id" FROM "category" WHERE "slug" = $1 LIMIT 1',
        [service.categorySlug],
      );
      const [existing] = await queryRunner.query(
        `
          SELECT "id"
          FROM "service"
          WHERE lower(trim("name")) = lower(trim($1))
            AND "type" = $2
          ORDER BY "deletedAt" NULLS FIRST
          LIMIT 1
        `,
        [service.name, ServiceType.Service],
      );
      const values = [
        service.name,
        service.description,
        category?.id ?? null,
        service.price,
        JSON.stringify(service.skills),
      ];

      if (existing?.id) {
        await queryRunner.query(
          `
            UPDATE "service"
            SET "name" = $1,
                "description" = $2,
                "categoryId" = COALESCE($3, "categoryId"),
                "price" = $4,
                "skills" = $5,
                "deletedAt" = NULL
            WHERE "id" = $6
          `,
          [...values, existing.id],
        );
        continue;
      }

      await queryRunner.query(
        `
          INSERT INTO "service" (
            "id", "type", "name", "description", "categoryId", "price",
            "image", "skills", "deletedAt"
          )
          VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, NULL)
        `,
        [service.id, ServiceType.Service, ...values],
      );
    }
  }

  public async down(): Promise<void> {
    // Catalog rows are intentionally preserved because recommendations and
    // orders may already reference them.
  }
}

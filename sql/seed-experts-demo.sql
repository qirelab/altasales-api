-- Demo seed для тестирования каталога экспертов (QIR-474 / QIR-519).
-- Идемпотентен. Можно прогонять повторно — старые seed-записи чистятся в начале.
--
-- UUID-ы корректные v4 (группа 3 = '4xxx', группа 4 = '8xxx') —
-- проходят class-validator @IsUUID('4') в DTO.
--
-- Что засеется:
--   * 2 группы экспертов (positions)
--   * 20 услуг (offerings) на каждую группу = 40 услуг всего
--   * 40 пользователей с role='expert' (по 20 на группу, без перекрытий)
--   * матрица цен для каждой пары (исполнитель × услуга его группы)
--     = 20 × 20 = 400 цен × 2 группы = 800 строк
--
-- Прогон:
--   psql "<DATABASE_URL>" -f sql/seed-experts-demo.sql

BEGIN;

-- ---------------------------------------------------------------------
-- 0a. Гарантируем slug='experts' у категории «Эксперты».
-- ---------------------------------------------------------------------
UPDATE "category"
SET "slug" = 'experts'
WHERE "name" = 'Эксперты'
  AND ("slug" IS NULL OR "slug" = '');

-- ---------------------------------------------------------------------
-- 0b. Чистим прошлый seed (как с v1-, так и с v4-префиксами).
--     Сначала убираем expert-cart_item-ы (каскадом снимаются cart_item_offering),
--     иначе FK RESTRICT на expert_position_offering блокирует удаление групп.
-- ---------------------------------------------------------------------
DELETE FROM "cart_item"
WHERE "expertPositionId" IS NOT NULL;

DELETE FROM "expert_position"
WHERE "id"::text LIKE '11111111-1111-%';

DELETE FROM "user"
WHERE "email" LIKE 'demo-expert-%@altasales.dev';

-- ---------------------------------------------------------------------
-- 0c. 40 тестовых пользователей-экспертов (по 20 на каждую группу).
--     ID: aaaaaaaa-aaaa-4aaa-8aaa-{12-char zfill index 1..40}
-- ---------------------------------------------------------------------
INSERT INTO "user" (
  "id", "name", "lastName", "email", "phoneNumber", "firebaseUid",
  "balance", "role", "ropProjectId", "experienceYears", "hasSeenGiftIntro", "createdAt"
)
SELECT
  ('aaaaaaaa-aaaa-4aaa-8aaa-' || LPAD(n::text, 12, '0'))::uuid,
  'Тестовый',
  'Эксперт ' || n::text,
  'demo-expert-' || n::text || '@altasales.dev',
  '+7' || LPAD(n::text, 10, '0'),
  NULL,
  0,
  'expert',
  NULL,
  3 + (n % 13),  -- 3..15 лет опыта, детерминированно по индексу
  true,
  now()
FROM generate_series(1, 40) AS n
ON CONFLICT ("id") DO NOTHING;

-- ---------------------------------------------------------------------
-- 1. Группы (expert_position) — 2 шт.
--    ID: 11111111-1111-4111-8111-{12-char zfill 1..2}
-- ---------------------------------------------------------------------
INSERT INTO "expert_position" ("id", "name", "description", "createdAt")
VALUES
  (
    '11111111-1111-4111-8111-000000000001'::uuid,
    'Руководитель отдела продаж',
    'Эксперт по постановке системы продаж: воронка, CRM, мотивация, регламенты, найм РОПа.',
    now()
  ),
  (
    '11111111-1111-4111-8111-000000000002'::uuid,
    'Финансовый эксперт',
    'Аудит и постановка финансового учёта, P&L, бюджетирование, маржинальность, кэш-флоу.',
    now()
  )
ON CONFLICT ("id") DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Услуги групп (20 услуг × 2 группы = 40 услуг)
--    ID: 22222222-2222-4222-8222-{6-char pos zfill}{6-char off zfill}
-- ---------------------------------------------------------------------
INSERT INTO "expert_position_offering" ("id", "positionId", "name", "description")
SELECT
  (
    '22222222-2222-4222-8222-'
    || LPAD(pos_idx::text, 6, '0')
    || LPAD(off_idx::text, 6, '0')
  )::uuid,
  ('11111111-1111-4111-8111-' || LPAD(pos_idx::text, 12, '0'))::uuid,
  'Услуга ' || off_idx::text,
  'Тестовая услуга №' || off_idx::text || ' в группе ' || pos_idx::text
FROM generate_series(1, 2) AS pos_idx
CROSS JOIN generate_series(1, 20) AS off_idx
ON CONFLICT ("id") DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. Привязка экспертов к группам
--    Эксперты 1..20  → Position 1 (РОП)
--    Эксперты 21..40 → Position 2 (Финансовый)
-- ---------------------------------------------------------------------
INSERT INTO "expert_position_member" ("id", "positionId", "userId", "createdAt")
SELECT
  uuid_generate_v4(),
  (CASE
    WHEN n BETWEEN 1 AND 20 THEN '11111111-1111-4111-8111-000000000001'
    ELSE                          '11111111-1111-4111-8111-000000000002'
  END)::uuid,
  ('aaaaaaaa-aaaa-4aaa-8aaa-' || LPAD(n::text, 12, '0'))::uuid,
  now()
FROM generate_series(1, 40) AS n
ON CONFLICT ("positionId", "userId") DO NOTHING;

-- ---------------------------------------------------------------------
-- 4. Цены: для каждой пары (member × offering группы member).
--    Базовая цена услуги = 5000 × offering_rank (5000, 10000, ..., 100000)
--    Множитель эксперта = 1 + 0.05 × (member_rank - 1) (1.00, 1.05, ..., 1.95)
-- ---------------------------------------------------------------------
INSERT INTO "expert_position_member_offering" ("id", "memberId", "offeringId", "price")
SELECT
  uuid_generate_v4(),
  m."id"   AS "memberId",
  o."id"   AS "offeringId",
  ROUND(
    (5000 * o.offering_rank) * (1 + (m.member_rank - 1) * 0.05)
  )::numeric(12, 2) AS "price"
FROM (
  SELECT
    "id",
    "positionId",
    ROW_NUMBER() OVER (PARTITION BY "positionId" ORDER BY "createdAt" ASC, "id" ASC) AS member_rank
  FROM "expert_position_member"
) m
JOIN (
  SELECT
    "id",
    "positionId",
    ROW_NUMBER() OVER (PARTITION BY "positionId" ORDER BY "name" ASC, "id" ASC) AS offering_rank
  FROM "expert_position_offering"
) o ON o."positionId" = m."positionId"
ON CONFLICT ("memberId", "offeringId") DO NOTHING;

COMMIT;

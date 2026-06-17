# Catalog images — API guide for frontend

Картинки каталога (подрядчик, услуга, группа экспертов, пакет) хранятся как **публичный URL** в поле `image` соответствующей сущности.

**Не** используйте `POST /files/upload` — это ROP (чат, файлы заказов).

Admin-ручки требуют **роль admin** и **session cookie**. Публичный каталог — без авторизации.

---

## Общая загрузка файла → URL

```http
POST /catalog-storage/images/upload?folder=<folder>
Content-Type: multipart/form-data
Cookie: session=...
```

Body: поле `file` (JPEG, PNG, WebP, HEIC; до 5 МБ).

**Ответ 201:**

```json
{
  "url": "http://localhost:4000/uploads/catalog/<folder>/<uuid>.jpeg",
  "storagePath": "catalog/<folder>/<uuid>.jpeg"
}
```

| Сущность | Query `folder` |
|----------|----------------|
| Подрядчик (contractor / corp) | `services` |
| Услуга / документ | `services` |
| Пакет | `packages` |
| Группа экспертов | `expert-groups` |

Поле `url` — в `<img src>` и в `image` при POST/PATCH сущности. Отдельного GET для файла нет: статика по `/uploads/...`.

---

## Подрядчик (contractor / corp)

Сущность: `Service` с `type = Подрядчик`.

### Получить картинку

| Действие | Endpoint | Поле |
|----------|----------|------|
| Карточка | `GET /services/admin/contractors/:id` | `contractor.image` |
| Список | `GET /services/admin/contractors` | `data[].image` |

### Создать

```http
POST /services/admin/contractors
```

```json
{
  "name": "...",
  "description": "...",
  "ratePerHour": 2500,
  "experienceYears": 5,
  "skills": ["..."],
  "specialization": "CRM-интегратор",
  "userId": "<uuid>",
  "image": "<url>"
}
```

`image` опционально. Перед этим: `POST /catalog-storage/images/upload?folder=services`.

### Обновить / удалить картинку

```http
PATCH /services/admin/contractors/:id
```

```json
{ "image": "<новый url>" }
```

Удалить: `{ "image": null }`. Если фото не меняется — `image` не передавать.

### Флоу

```
create:  upload? → POST /services/admin/contractors { ..., image: url }
edit:    GET /services/admin/contractors/:id → contractor.image
save:    upload? → PATCH ... { image: newUrl, ... }
```

---

## Услуга / документ (service)

Сущность: `Service` с `type = Услуга` или `Документ`.

### Получить картинку

| Действие | Endpoint | Поле |
|----------|----------|------|
| Admin карточка | `GET /services/admin/:id` | `service.image` |
| Admin список | `GET /services/admin` | `data[].image` |
| Публичный каталог | `GET /services` | `services[].image` |
| Публичная карточка | `GET /services/:id` | `image` |

### Создать

```http
POST /services/admin
```

```json
{
  "type": "Услуга",
  "name": "...",
  "description": "...",
  "price": 50000,
  "categoryId": "<uuid>",
  "skills": ["..."],
  "giftEligible": false,
  "image": "<url>"
}
```

`image` опционально. Upload: `folder=services`.

### Обновить / удалить картинку

```http
PATCH /services/admin/:id
```

```json
{ "image": "<новый url>" }
```

Удалить: `{ "image": null }`.

### Флоу

```
create:  upload? → POST /services/admin { ..., image: url }
edit:    GET /services/admin/:id → service.image
save:    upload? → PATCH /services/admin/:id { image: newUrl, ... }
```

---

## Группа экспертов (expert group)

Сущность: `expert_position`. Admin API под префиксом `/admin/expert-groups`.

### Получить картинку

| Действие | Endpoint | Поле |
|----------|----------|------|
| Admin карточка | `GET /admin/expert-groups/:id` | `image` |
| Admin список | `GET /admin/expert-groups` | `data[].image` |
| Публичный каталог | `GET /experts/positions` | `[].image` |
| Публичная карточка | `GET /experts/positions/:id` | `image` |

### Создать

```http
POST /admin/expert-groups
```

```json
{
  "title": "Маркетолог",
  "description": "...",
  "iconLabel": "MRK",
  "image": "<url>"
}
```

`image` и `iconLabel` опциональны. Upload: `folder=expert-groups`.

### Обновить / удалить картинку

```http
PATCH /admin/expert-groups/:id
```

```json
{ "image": "<новый url>" }
```

Удалить: `{ "image": null }`.

### Флоу

```
create:  upload? → POST /admin/expert-groups { ..., image: url }
edit:    GET /admin/expert-groups/:id → image
save:    upload? → PATCH /admin/expert-groups/:id { image: newUrl, ... }
```

---

## Пакет (package) — справочно

Upload: `folder=packages`.

| Действие | Endpoint | Поле |
|----------|----------|------|
| Admin карточка | `GET /packages/admin/:id` | `package.image` (в обёртке ответа) |
| Admin список | `GET /packages/admin` | `data[].image` |
| Публичный каталог | `GET /packages` | `[].image` |

`POST /packages/admin` / `PATCH /packages/admin/:id` — поле `image` (URL), тот же паттерн.

---

## Не использовать для картинок каталога

| Endpoint | Назначение |
|----------|------------|
| `POST /files/upload` | ROP (чат, заказы) |
| `GET /files/:id/url` | Presigned URL ROP-файла |

---

## Env (бэкенд)

```env
CATALOG_UPLOAD_DIR=./uploads
CATALOG_PUBLIC_BASE_URL=http://localhost:4000/uploads
```

Статика отдаётся с префиксом `/uploads/`.

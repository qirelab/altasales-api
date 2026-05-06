# Интеграция с Робокассой

## Переменные окружения (.env)

```env
ROBOKASSA_MERCHANT_LOGIN=your_merchant_login
ROBOKASSA_PASSWORD_1=Password1
ROBOKASSA_PASSWORD_2=Password2
ROBOKASSA_IS_TEST=1
```

- **ROBOKASSA_MERCHANT_LOGIN** — логин магазина из личного кабинета Робокассы.
- **ROBOKASSA_PASSWORD_1** — Пароль №1 из технических настроек магазина (для подписи запроса на оплату).
- **ROBOKASSA_PASSWORD_2** — Пароль №2 (для проверки подписи в Result URL).
- **ROBOKASSA_IS_TEST** — `1` для тестового режима, `0` для боевого.

## Настройка в личном кабинете Робокассы

1. Зарегистрируйтесь на [partner.robokassa.ru](https://partner.robokassa.ru).
2. Создайте магазин и откройте «Технические настройки».
3. Укажите **Result URL**: `https://your-api.com/payments/robokassa/result` (POST).
4. При необходимости укажите **Success URL** и **Fail URL** для редиректа пользователя после оплаты.
5. Алгоритм хэша: **MD5** (по умолчанию в коде).
6. В тестовом режиме используйте тестовые пароли из этой же вкладки.

## API

### Создание платежа на пополнение баланса

**POST** `/payments/robokassa/topup/create`

Тело (JSON):

```json
{
  "amount": 990.5,
  "description": "Пополнение внутреннего баланса"
}
```

- Требуется авторизация (session cookie).
- Ответ: `{ "paymentUrl": "https://auth.robokassa.ru/Merchant/Index.aspx", "params": { "MerchantLogin", "OutSum", "InvId", "Description", "SignatureValue", "IsTest" } }`.

Фронт может отправить форму **POST** на `paymentUrl` с полями из `params` либо собрать ссылку **GET** вида  
`paymentUrl?MerchantLogin=...&OutSum=...&InvId=...&Description=...&SignatureValue=...&IsTest=1` и перенаправить пользователя.

### Result URL (callback)

**POST** `/payments/robokassa/result`

Этот адрес указывается в настройках магазина как Result URL. Робокасса отправляет сюда POST с полями:

- OutSum, InvId, SignatureValue, Fee, EMail, PaymentMethod, IncCurrLabel и т.д.

Сервер проверяет подпись (Password #2), обновляет платёж в БД и отвечает **текстом** `OK{InvId}` (например, `OK12`). Другой ответ считается ошибкой, Робокасса может повторять запрос.

После успешного подтверждения:

- если платёж связан с заказом — заказ переводится в `in_progress`;
- если платёж связан с пользователем (пополнение) — средства зачисляются во внутренний баланс пользователя.

### Fail URL

**POST** `/payments/robokassa/fail`

Этот endpoint можно указать как Fail URL. Сервер помечает платёж как `failed`, если он еще не был подтвержден как `paid`.

## Чек-лист

1. Добавить переменные в `.env`.
2. В личном кабинете задать Result URL = `https://ваш-домен/payments/robokassa/result`.
3. Для тестов использовать тестовые пароли и `ROBOKASSA_IS_TEST=1`.
4. Убедиться, что Result URL доступен из интернета (не localhost; для локальной отладки можно использовать ngrok).

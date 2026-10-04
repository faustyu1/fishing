# dotme

Личная био-страница **[faustyu.xyz](https://faustyu.xyz)**: карточка с соцсетями и тем, что я сейчас слушаю в Spotify.

React + Vite + TypeScript на фронте, serverless-функции Vercel на бэке.

## Что на странице

- **Профиль.** Аватарка из Telegram, а если она не грузится, то ⛄. По клику аватарка трясётся и сыплет конфетти со снежинками.
- **Соцсети:** Telegram, GitHub, X.
- **Spotify now playing** через официальный Spotify Web API:
  - трек, артист, обложка, эквалайзер;
  - полоска прогресса с таймером;
  - устройство, на котором играет (имя владельца из названия устройства вырезается);
  - статусы `now playing`, `paused` и `offline · 3h ago`;
  - акцентный цвет карточки берётся из обложки;
  - история из последних трёх треков;
  - обновляется каждые 5 секунд и сразу при возврате на вкладку.
- **Слушать вместе.** Кнопка с динамиком открывает плеер Spotify с тем же треком и переключает его вслед за мной. Залогиненные в Spotify слышат трек целиком, остальные 30-секундное превью.
- **Счётчик просмотров** с защитой от накрутки: максимум один просмотр с IP в сутки, подписанный сервером челлендж, минимальное время на странице, proof-of-work в браузере и фильтр ботов.
- **Фон:** мерцающие звёзды и падающие метеоры на canvas.
- **Часы** в моём часовом поясе (Europe/Samara).
- **Адаптив** под телефоны от 320px; на сенсорных экранах hover-эффекты выключены.

## Структура

```
api/spotify.js           Spotify: текущий трек, устройство, история (serverless-функция)
api/views.js             счётчик просмотров с защитой от накрутки (serverless-функция)
server.js                локальный Express-сервер для этих же функций (порт 4000)
scripts/spotify-auth.js  одноразовое получение refresh token Spotify
src/App.tsx              вся страница
src/index.css            стили
public/                  иконки, курсоры, og.png для превью ссылок
```

## Локальный запуск

```bash
npm install
```

Создай `.env.server`, файл уже в `.gitignore`:

```bash
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
VIEWS_SECRET=...   # любая длинная случайная строка: openssl rand -base64 32
```

Получи refresh token Spotify и допиши его в `.env.server`:

```bash
npm run spotify:auth
```

Запусти фронт и API вместе:

```bash
npm run dev:full
```

Сайт откроется на http://localhost:3000, API на порту 4000 (Vite проксирует `/api`). Без Postgres счётчик просмотров хранится в `.data/views.json`.

Как создать приложение в Spotify Dashboard, какие нужны scopes и как устроен счётчик, описано в [SERVER.md](SERVER.md).

## Деплой

Vercel деплоит автоматически при пуше в `main`. Переменные окружения проекта:

| Переменная | Зачем |
| --- | --- |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN` | Spotify Web API |
| `VIEWS_SECRET` | подпись челленджей и хэши IP для счётчика |
| `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE` | хранилище просмотров |
| `POSTGRES_SSL=true` | по желанию, если сервер Postgres поддерживает SSL |

## Скрипты

| Команда | Что делает |
| --- | --- |
| `npm run dev` | только фронт (Vite) |
| `npm run server` | только API |
| `npm run dev:full` | фронт и API вместе |
| `npm run build` | проверка типов и продакшен-сборка в `dist/` |
| `npm run preview` | просмотр собранной версии |
| `npm run spotify:auth` | получить refresh token Spotify |

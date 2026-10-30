# Coal & Ash tender management

Phase 1 runs the tender workflow on this machine: upload, 44-field extraction, relevance, parallel costing and EMD, working-time SLAs, bid evidence, and the management register.

Phase 2 portal scanning is configuration and an exception queue only. A discovered tender can be registered into the same workflow and is assigned to Vishesh. The app does not crawl portals.

## Layout

```
client/   React 19 + Vite + React Router single-page app (port 5173)
server/   Node.js + Express 5 API, Prisma ORM on MySQL (port 4000)
  prisma/   schema.prisma (MySQL) and seed.ts
  scripts/  db-setup.ts (creates the database and tables), check-domain.ts
  data/     uploaded files (data/uploads) and the OCR tunnel address
```

The client talks to the server only over `/api`. In development Vite proxies `/api` to the server. `npm run build` puts the built client inside the server, in `server/public`, and the server serves it on port 4000 next to the API.

## Requirements

- Node.js 20 or newer
- MySQL 8.0.13 or newer (or MariaDB 10.2+)

## Run

```bash
npm install
```

### Local MySQL on this Mac

MySQL 8.4 is installed in `~/coal-ash-mysql` (no admin rights needed) and listens on 127.0.0.1:3306 only. It does not start by itself after a restart:

```bash
npm run mysql:start
```

`npm run mysql:stop` stops it. Passwords are in `~/coal-ash-mysql/credentials.txt`; the app connects as the `coal_ash` user set in `server/.env`. Logs are in `~/coal-ash-mysql/mysqld.log`.

Copy `server/.env.example` to `server/.env` (skip if it exists) and set `DATABASE_URL` to your MySQL server, for example:

```
DATABASE_URL="mysql://root:password@localhost:3306/coal_ash"
```

Create the database, tables and sample data:

```bash
npm run db:setup
```

Start the API and the client together:

```bash
npm run dev
```

Open http://localhost:5173. The sign-in page lists the team. The initial password is `CoalAsh@2026`.

You can also run each package on its own: `npm run dev` inside `server`, and `npm run dev` inside `client`.

`npm run db:reset` drops every table and seeds again. `db:setup` leaves existing tables alone.

### Why db:setup and not prisma db push

Prisma writes `TEXT ... DEFAULT ''`, which MySQL rejects. `server/scripts/db-setup.ts` generates the SQL from `schema.prisma`, rewrites those defaults as MySQL expression defaults (`DEFAULT ('')`), and runs it. After changing the schema on a database with real data, write the `ALTER TABLE` by hand or use `prisma migrate diff` against the live database and apply the same fix.

## OCR

The OCR service downloads each upload from `OCR_PUBLIC_BASE_URL` (or the address in `server/data/ocr-public-base.txt`) at `/api/ocr-files/...`. The Express server answers that path itself, so point the public tunnel at port 4000 (or 5173 in development, which proxies to it). The old separate file server on port 3999 is gone.

## Email

Set `SMTP_HOST` and the related variables in `server/.env` when email delivery is ready. Until then, every notice is stored in Notifications.

## Build and run on one port (4000)

```bash
npm run serve
```

That builds the React client into `server/public` and starts the server, which serves the app and the API at http://localhost:4000. The two steps separately are `npm run build` and `npm start`. Stop `npm run dev` first; both use port 4000.

A running server picks up a new build without a restart: run `npm run build` again and refresh the browser.

## Checks

```bash
npm run typecheck
npm run check
```

`check` covers working-time arithmetic and extraction of the bundled notice. It does not start the app.

## Moved from Next.js

This used to be one Next.js app with server components and server actions. Each server action is now `POST /api/actions/<name>` (see `server/src/http/actions.ts`), and each page loads its data from `GET /api/<page>` (see `server/src/http/views.ts`). The pure helpers the pages need (labels, calendar, fields, money) are copied into `client/src/lib`; keep them in step with `server/src/lib`.

The old SQLite database is kept at `server/data/coal-ash.sqlite.db` for reference. A full copy of the Next.js project is in `backup-nextjs-2026-10-30.tar.gz`.

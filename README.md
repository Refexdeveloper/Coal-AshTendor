# Coal & Ash tender management

Phase 1 runs the tender workflow on this machine: upload, 44-field extraction, relevance, parallel costing and EMD, working-time SLAs, bid evidence, and the management register.

Phase 2 portal scanning is configuration and an exception queue only. A discovered tender can be registered into the same workflow and is assigned to Vishesh. The app does not crawl portals.

## Layout

```
client/src
  pages/      route screens, grouped by area (tenders, portals, admin)
  layout/     app shell, sidebar, and session layout
  api/        fetch client, session, and form actions
  components/ shared controls
  lib/        labels, field definitions, shared types
  utils/      calendar, money, and display helpers
server/src
  index.ts    process entry: load env and listen
  app.ts      Express app: middleware, route mounting, static client
  routes/     HTTP routers (auth, actions, page data, files)
  middleware/ session cookie and CORS
  services/   tender workflow, extraction, OCR, files, metrics
  db/         MySQL access
  utils/      calendar, fields, labels, tokens
  schema.sql lives in server/; scripts/ sets up and seeds the database
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

Copy `server/.env.example` to `server/.env` (skip if it exists) and set `DB_HOST`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`. `DATABASE_URL` still works when you set it, and it overrides those four.

Docker uses the same file. Copy `docker-compose.example.yml` to `docker-compose.yml`, create the external network once (`docker network create proxy`), and set `PORT` in `server/.env` to the port exposed in the compose file (4000).

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

### Schema changes

`server/schema.sql` is the database. `npm run db:setup` creates any missing database and runs that file when the tables are not there yet. After editing `schema.sql` on a database that already has tables, apply the `ALTER TABLE` yourself, or run `npm run db:reset` when the data can be dropped and seeded again. Text columns use `DEFAULT ('')` because MySQL rejects `DEFAULT ''` on `TEXT`.

## OCR

Each upload is saved, given a short-lived signed public link (`/api/ocr-files/...`), and that link is posted to the Unfyd ExtractData API (`OCR_EXTRACT_URL`, `DocumentType: "Tendor"`). The `Extracted Fields` in the response fill the 44 tender fields (`server/src/lib/ocr.ts`): dates become DD/MM/YYYY HH:MM, choices like "Yes (MSME exempt)" become "Yes", and "N/A" answers are left blank.

The OCR service must be able to download the link, so the server needs a public address. Start a tunnel next to the server and keep it running:

```bash
npm run tunnel
```

It opens a Cloudflare quick tunnel to port 8080 (pass another port as `npm run tunnel -- 4000`) and saves the address in `server/data/ocr-public-base.txt`. The address changes each time the tunnel starts. On a server with its own public URL, set `OCR_PUBLIC_BASE_URL` instead.

## Email

Set `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` in `server/.env` (for Google Workspace, `SMTP_PASS` is an App Password). Until all three are set, every notice is only stored in Notifications.

`MAIL_STEP_COPY_TO` (comma separated) gets an email for every workflow step: upload, extraction, field validation, relevance, costing, approval, EMD, submitter, bid, outcome. `MAIL_REDIRECT_TO` sends all other notices to one inbox for testing.

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

This used to be one Next.js app with server components and server actions. Each server action is now `POST /api/actions/<name>` (see `server/src/routes/actions.ts`), and each page loads its data from `GET /api/<page>` (see `server/src/routes/views.ts`). Labels and field definitions are copied into `client/src/lib`. Calendar, money, and display helpers are copied into `client/src/utils`. Keep those copies in step with `server/src/utils`.

The old SQLite database is kept at `server/data/coal-ash.sqlite.db` for reference. A full copy of the Next.js project is in `backup-nextjs-2026-10-30.tar.gz`.

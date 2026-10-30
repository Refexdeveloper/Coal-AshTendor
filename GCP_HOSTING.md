# =============================================================================
# Coal & Ash tender management — Architecture & GCP Hosting Guide
# =============================================================================
# Mirrors the kavis-npi-portal pattern: one Cloud Run service (client + API),
# dedicated Cloud SQL MySQL, and one private GCS docs bucket.
# Live reference: https://kavis-npi-portal-645830234926.asia-south1.run.app
# =============================================================================

## 1. What this product is

**Coal & Ash tender management** — upload → 44-field extraction → relevance /
costing / EMD workflow, with bid evidence and a management register.

One deployable unit: **frontend + API on the same Cloud Run service**, same
domain. Database and tender documents live in **managed GCP services** (not in
the container filesystem).

```
GitHub
  │
  ▼
Docker build (Vite client → server/public + Node server)
  │
  ▼
Cloud Run (1 service)
  ├── Serves SPA  (/ , /tenders, assets…)
  └── Serves API  (/api/…)
        │
        ├── Cloud SQL for MySQL  ← structured app data
        └── Cloud Storage bucket ← tender documents / OCR files
```

---

## 2. Languages & technologies

| Layer | Language / tool | Used for |
|-------|-----------------|----------|
| **Frontend UI** | **TypeScript (React 19)** | Tender / portal / admin screens |
| **Frontend build** | **Vite 7** | Production bundle into `server/public` |
| **Frontend routing** | **React Router** | Client-side routes; Express SPA fallback |
| **Backend API** | **TypeScript** on **Node.js ≥ 20** | Express routes, session auth, workflow |
| **HTTP framework** | **Express 5** | `/api/*`, static SPA hosting, multipart uploads |
| **Database access** | **mysql2** | Pool to MySQL / Cloud SQL |
| **SQL schema** | **SQL (MySQL dialect)** | `server/schema.sql` |
| **Auth** | Session cookie + bcrypt | Login; password hashing |
| **Document I/O** | Local FS **or** **@google-cloud/storage** | Upload/download via API (never public bucket URLs) |
| **Container** | **Docker** | Cloud Run image: built SPA + API process |
| **Cloud hosting** | **Google Cloud Run** | HTTPS, autoscaling, single URL for UI + API |
| **Cloud database** | **Cloud SQL for MySQL 8** | Durable relational data |
| **Cloud files** | **Cloud Storage (GCS)** | Private bucket for tender documents |

### Why this split

1. **One Cloud Run service** — users hit one HTTPS origin; no CORS pain; SPA + API versioned together.
2. **MySQL (Cloud SQL)** — matches local MySQL already used in development.
3. **Separate GCS bucket** — Cloud Run disks are ephemeral; documents must live outside the container.
4. **API-proxied downloads** — documents stay private; ACL stays in Express.
5. **Vite `outDir: server/public`** — Express serves the built client from the same process.

---

## 3. Clean architecture (local vs GCP)

| Concern | Local development | GCP production |
|---------|-------------------|----------------|
| App process | `npm run build && npm start` | Cloud Run container |
| UI | `server/public` served by Express | Same, baked into image |
| Database | Local MySQL `coal_ash` | **Cloud SQL** instance + database `coal_ash` |
| Documents | `server/data/uploads/` (`STORAGE_BACKEND=local`) | **GCS bucket** (`STORAGE_BACKEND=gcs`) |
| Secrets | `server/.env` (gitignored) | Cloud Run env + Secret Manager |
| Identity to GCP | n/a | Cloud Run **service account** (ADC — no key file in image) |

### Code touchpoints

- `server/src/services/files.ts` — `local` \| `gcs` backends  
- `server/src/db/index.ts` + `server/src/env.ts` — TCP (`DB_HOST`) or Cloud SQL Unix socket (`INSTANCE_CONNECTION_NAME`)  
- `server/src/bootstrap.ts` — first-boot schema + seed  
- `Dockerfile` — single image for Cloud Run  
- `scripts/gcp-deploy.sh` — create resources + deploy  

---

## 4. Credentials & environment variables

**Never commit real secrets.** Put production values in Cloud Run / Secret Manager only.

### 4.1 Application / security

| Variable | Required | Notes |
|----------|----------|-------|
| `SESSION_SECRET` | **Yes (prod)** | Long random string (32+ chars) |
| `NODE_ENV` | Recommended | `production` on Cloud Run |
| `PORT` | Auto on Cloud Run | Cloud Run sets this (`8080`) |
| `HOST` | Optional | `0.0.0.0` |
| `APP_URL` / `PUBLIC_APP_URL` / `FRONTEND_URL` | Prod | Cloud Run service URL (OCR + email links) |
| `CLIENT_ORIGIN` | Optional | Same-origin UI usually needs none |
| `DEMO_LOGIN_HINT` | Optional | `true` lists team on sign-in |

### 4.2 MySQL / Cloud SQL

| Variable | Required | Notes |
|----------|----------|-------|
| `DB_NAME` | Yes | `coal_ash` |
| `DB_USER` | Yes | e.g. `coal_ash_app` |
| `DB_PASSWORD` | Yes | Secret Manager |
| `DB_HOST` | Local / public IP | `127.0.0.1` |
| `DB_PORT` | With host | `3306` |
| `INSTANCE_CONNECTION_NAME` | **Cloud Run + Cloud SQL connector** | `PROJECT_ID:REGION:INSTANCE_NAME` |
| `AUTO_DB_SETUP` / `AUTO_DB_SEED` | Optional | Default on; first boot creates schema + seed |

**Prefer on Cloud Run:** set `INSTANCE_CONNECTION_NAME` and attach the Cloud SQL instance to the service (Unix socket).

### 4.3 Document storage (GCS)

| Variable | Required | Notes |
|----------|----------|-------|
| `STORAGE_BACKEND` | Yes for prod | `gcs` on Cloud Run; `local` on laptop |
| `GCS_BUCKET` | Yes if gcs | e.g. `coal-ash-docs-master-diorama-489103-u2` |
| `GCS_PREFIX` | Optional | Default `coal-ash-docs/` |

**Auth to GCS:** Cloud Run service account with `roles/storage.objectAdmin` on that bucket. **No JSON key file in the Docker image.**

### 4.4 Demo accounts (seed data)

| Password | Notes |
|----------|-------|
| `CoalAsh@2026` | Initial password for seeded team (change in production) |

---

## 5. Create GCP resources

Replace placeholders or use `scripts/gcp-deploy.sh`.

```bash
gcloud config set project master-diorama-489103-u2
gcloud config set run/region asia-south1

# One-shot (recommended):
bash scripts/gcp-deploy.sh
```

Manual steps (same project / region as kavis-npi-portal):

```bash
PROJECT_ID=master-diorama-489103-u2
REGION=asia-south1
SQL_INSTANCE=coal-ash-mysql
DOCS_BUCKET=coal-ash-docs-${PROJECT_ID}
SERVICE=coal-ash-tender
SA_NAME=coal-ash-run

gcloud services enable \
  run.googleapis.com sqladmin.googleapis.com sql.googleapis.com \
  storage.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com

gcloud iam service-accounts create ${SA_NAME} --display-name="Coal Ash Cloud Run"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud sql instances create ${SQL_INSTANCE} \
  --database-version=MYSQL_8_0 --tier=db-f1-micro --region=${REGION} \
  --storage-size=20GB --storage-auto-increase --root-password='REPLACE_ROOT_PASSWORD'

gcloud sql databases create coal_ash --instance=${SQL_INSTANCE}
gcloud sql users create coal_ash_app --instance=${SQL_INSTANCE} --password='REPLACE_APP_PASSWORD'

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/cloudsql.client"

gcloud storage buckets create gs://${DOCS_BUCKET} \
  --location=${REGION} --uniform-bucket-level-access
gcloud storage buckets update gs://${DOCS_BUCKET} --public-access-prevention
gcloud storage buckets add-iam-policy-binding gs://${DOCS_BUCKET} \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/storage.objectAdmin"
```

**Connection name:**

```bash
gcloud sql instances describe coal-ash-mysql --format='value(connectionName)'
# → master-diorama-489103-u2:asia-south1:coal-ash-mysql
```

---

## 6. Build & deploy to Cloud Run

From the **repository root** (where `Dockerfile` lives):

```bash
export PROJECT_ID=master-diorama-489103-u2
export REGION=asia-south1
export SERVICE=coal-ash-tender
export SA_EMAIL=coal-ash-run@${PROJECT_ID}.iam.gserviceaccount.com
export SQL_CONNECTION=${PROJECT_ID}:${REGION}:coal-ash-mysql
export DOCS_BUCKET=coal-ash-docs-${PROJECT_ID}
export IMAGE=${REGION}-docker.pkg.dev/${PROJECT_ID}/coal-ash/${SERVICE}:latest

gcloud builds submit --tag ${IMAGE} .

gcloud run deploy ${SERVICE} \
  --image ${IMAGE} \
  --region ${REGION} \
  --platform managed \
  --allow-unauthenticated \
  --service-account ${SA_EMAIL} \
  --add-cloudsql-instances ${SQL_CONNECTION} \
  --set-env-vars "NODE_ENV=production,DB_NAME=coal_ash,DB_USER=coal_ash_app,INSTANCE_CONNECTION_NAME=${SQL_CONNECTION},STORAGE_BACKEND=gcs,GCS_BUCKET=${DOCS_BUCKET},GCS_PREFIX=coal-ash-docs/,AUTO_DB_SETUP=true,AUTO_DB_SEED=true,DEMO_LOGIN_HINT=true" \
  --set-secrets "DB_PASSWORD=coal-ash-db-password:latest,SESSION_SECRET=coal-ash-session-secret:latest" \
  --memory 1Gi --cpu 1 --min-instances 0 --max-instances 10
```

Check: `https://YOUR_RUN_URL/api/health` → should show `"database":"up","storage":"gcs","serve_client":true`.

---

## 7. Local production-like run (before GCP)

```bash
cd server && cp .env.example .env   # edit DB_* / SESSION_SECRET
# From repo root
npm install
npm run build && npm start
# → http://localhost:4000  (SPA + API)
```

---

## 8. Security checklist

- [ ] GCS bucket **not** public; Uniform bucket-level access ON  
- [ ] Downloads only via authenticated `/api/documents/:id`  
- [ ] Strong `SESSION_SECRET` and DB password in Secret Manager  
- [ ] Cloud SQL not publicly open (use Cloud Run connector)  
- [ ] Change demo seed passwords before real users  
- [ ] IAM: least privilege on SA (Cloud SQL Client + objectAdmin on **one** docs bucket)  
- [ ] Dedicated SQL instance — do **not** share with kavis-npi-mysql / p2p-mysql  

---

## 9. Live deployment (this project)

| Item | Value |
|------|--------|
| GCP project | `master-diorama-489103-u2` |
| Region | `asia-south1` |
| Cloud Run | `coal-ash-tender-api` |
| App URL | https://coal-ash-tender-api-dhwffeu7pq-el.a.run.app |
| Alt URL | https://coal-ash-tender-api-645830234926.asia-south1.run.app |
| Health | https://coal-ash-tender-api-dhwffeu7pq-el.a.run.app/api/health |
| Cloud SQL instance | **`coal-ash-mysql`** (dedicated — not shared with Kavis) |
| Connection name | `master-diorama-489103-u2:asia-south1:coal-ash-mysql` |
| Database / user | `coal_ash_tender` / `coal_ash_app` |
| Docs bucket | `gs://coal-ash-docs-master-diorama-489103-u2` |
| Runtime SA | `coal-ash-run@master-diorama-489103-u2.iam.gserviceaccount.com` |
| Image | `asia-south1-docker.pkg.dev/master-diorama-489103-u2/coal-ash-repo/coal-ash-tender:…` |
| Secrets | `coal-ash-db-password`, `coal-ash-session-secret`, `coal-ash-database-url` |
| GitHub | https://github.com/Refexdeveloper/Coal-AshTendor |
| Reference app | https://kavis-npi-portal-645830234926.asia-south1.run.app |

**Isolation:** Cloud Run attaches only to `coal-ash-mysql`. Kavis keeps `kavis-npi-mysql` + its own buckets.

**Health check (live):** `"database":"up","storage":"gcs","serve_client":true,"cloud_sql":true`

Demo login password after seed: `CoalAsh@2026`

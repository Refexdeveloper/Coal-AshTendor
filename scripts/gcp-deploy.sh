#!/usr/bin/env bash
# Create Coal-Ash GCP resources (Cloud SQL + GCS + Cloud Run) in the same project
# pattern as kavis-npi-portal. Safe to re-run: skips existing resources.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-master-diorama-489103-u2}"
REGION="${REGION:-asia-south1}"
SQL_INSTANCE="${SQL_INSTANCE:-coal-ash-mysql}"
DB_NAME="${DB_NAME:-coal_ash}"
DB_USER="${DB_USER:-coal_ash_app}"
DOCS_BUCKET="${DOCS_BUCKET:-coal-ash-docs-${PROJECT_ID}}"
SERVICE="${SERVICE:-coal-ash-tender}"
SA_NAME="${SA_NAME:-coal-ash-run}"
AR_REPO="${AR_REPO:-coal-ash}"
ROOT_PASSWORD="${GCP_DB_ROOT_PASSWORD:-}"
APP_PASSWORD="${GCP_DB_APP_PASSWORD:-}"
SESSION_SECRET_VALUE="${SESSION_SECRET:-}"

if [[ -z "$ROOT_PASSWORD" ]]; then ROOT_PASSWORD="$(openssl rand -base64 24)"; fi
if [[ -z "$APP_PASSWORD" ]]; then APP_PASSWORD="$(openssl rand -base64 24)"; fi
if [[ -z "$SESSION_SECRET_VALUE" ]]; then SESSION_SECRET_VALUE="$(openssl rand -hex 32)"; fi

export PATH="${HOME}/google-cloud-sdk/bin:${PATH}"

gcloud config set project "$PROJECT_ID"
gcloud config set run/region "$REGION"

echo "==> Enabling APIs"
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  sql.googleapis.com \
  storage.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com

SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
  echo "==> Creating runtime service account ${SA_NAME}"
  gcloud iam service-accounts create "$SA_NAME" --display-name="Coal Ash Cloud Run"
fi

if ! gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1; then
  echo "==> Creating Cloud SQL instance ${SQL_INSTANCE} (this can take several minutes)"
  gcloud sql instances create "$SQL_INSTANCE" \
    --database-version=MYSQL_8_0 \
    --tier=db-f1-micro \
    --region="$REGION" \
    --storage-size=20GB \
    --storage-auto-increase \
    --root-password="$ROOT_PASSWORD"
else
  echo "==> Cloud SQL instance ${SQL_INSTANCE} already exists"
fi

if ! gcloud sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE" >/dev/null 2>&1; then
  gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE"
fi

if ! gcloud sql users list --instance="$SQL_INSTANCE" --format='value(name)' | grep -qx "$DB_USER"; then
  gcloud sql users create "$DB_USER" --instance="$SQL_INSTANCE" --password="$APP_PASSWORD"
else
  gcloud sql users set-password "$DB_USER" --instance="$SQL_INSTANCE" --password="$APP_PASSWORD"
fi

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/cloudsql.client" \
  --condition=None >/dev/null

if ! gcloud storage buckets describe "gs://${DOCS_BUCKET}" >/dev/null 2>&1; then
  echo "==> Creating docs bucket gs://${DOCS_BUCKET}"
  gcloud storage buckets create "gs://${DOCS_BUCKET}" \
    --location="$REGION" \
    --uniform-bucket-level-access
  gcloud storage buckets update "gs://${DOCS_BUCKET}" --public-access-prevention
fi

gcloud storage buckets add-iam-policy-binding "gs://${DOCS_BUCKET}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectAdmin" >/dev/null

ensure_secret() {
  local name="$1" value="$2"
  if ! gcloud secrets describe "$name" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets create "$name" --data-file=-
  else
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=-
  fi
  gcloud secrets add-iam-policy-binding "$name" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
}

ensure_secret coal-ash-db-password "$APP_PASSWORD"
ensure_secret coal-ash-session-secret "$SESSION_SECRET_VALUE"

if ! gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$AR_REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Coal & Ash tender images"
fi

SQL_CONNECTION="$(gcloud sql instances describe "$SQL_INSTANCE" --format='value(connectionName)')"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE}:latest"

echo "==> Building image ${IMAGE}"
gcloud builds submit --tag "$IMAGE" .

echo "==> Deploying Cloud Run service ${SERVICE}"
gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --service-account "$SA_EMAIL" \
  --add-cloudsql-instances "$SQL_CONNECTION" \
  --set-env-vars "NODE_ENV=production,HOST=0.0.0.0,DB_NAME=${DB_NAME},DB_USER=${DB_USER},INSTANCE_CONNECTION_NAME=${SQL_CONNECTION},STORAGE_BACKEND=gcs,GCS_BUCKET=${DOCS_BUCKET},GCS_PREFIX=coal-ash-docs/,AUTO_DB_SETUP=true,AUTO_DB_SEED=true,DEMO_LOGIN_HINT=true" \
  --set-secrets "DB_PASSWORD=coal-ash-db-password:latest,SESSION_SECRET=coal-ash-session-secret:latest" \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --timeout 300

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"

# Point public app / OCR base at the live Cloud Run URL
gcloud run services update "$SERVICE" \
  --region "$REGION" \
  --update-env-vars "APP_URL=${URL},PUBLIC_APP_URL=${URL},FRONTEND_URL=${URL},OCR_PUBLIC_BASE_URL=${URL}"

echo
echo "Deployed: ${URL}"
echo "Health:   ${URL}/api/health"
echo "SQL:      ${SQL_CONNECTION}"
echo "Bucket:   gs://${DOCS_BUCKET}"
echo "SA:       ${SA_EMAIL}"
echo "Demo password (seed): CoalAsh@2026"

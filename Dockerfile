# Single Cloud Run service: Vite client → server/public + Express API
# Attach Cloud SQL + set STORAGE_BACKEND=gcs / GCS_BUCKET (see GCP_HOSTING.md)
# Build context: repository root

FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json

RUN npm ci

COPY client client
COPY server server

RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV STORAGE_BACKEND=gcs

EXPOSE 8080

CMD ["npm", "start"]

FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY server/prisma server/prisma

RUN npm ci

COPY client client
COPY server server

RUN npm run build

ENV NODE_ENV=production
EXPOSE 8080

CMD ["npm", "start"]

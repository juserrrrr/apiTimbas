FROM node:20-slim AS deps
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

FROM deps AS builder
WORKDIR /app

COPY . .

RUN npm run build
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/data ./data
# o gif da fila é lido em runtime a partir de process.cwd()/images
COPY --from=builder /app/images ./images

EXPOSE 3333

CMD ["npm", "run", "start:prod"]

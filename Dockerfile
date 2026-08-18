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

# Sem teto, o V8 cresce até o host matar o processo, e a compilação morre sem
# imprimir erro nenhum. Com teto ele coleta lixo e termina, e um estouro de
# verdade vira "JavaScript heap out of memory" em vez de morte silenciosa.
RUN NODE_OPTIONS=--max-old-space-size=1024 npm run build
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

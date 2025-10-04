FROM node:20 AS builder

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install --include=dev

COPY . .

RUN npx nest build

FROM node:20-slim AS production

WORKDIR /app

ENV NODE_ENV=production

# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl --no-install-recommends

# Copy package.json and package-lock.json
COPY package*.json ./
COPY prisma ./prisma/

# Install production dependencies and ts-node
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
RUN npm install -g ts-node

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

RUN ls -la node_modules/.bin
RUN which ts-node || echo "ts-node not found in PATH"

EXPOSE 3333

CMD ["npm", "run", "start:migrate:prod"]
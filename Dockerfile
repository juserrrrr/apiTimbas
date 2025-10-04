# ---- Estágio 1: Build ----
FROM node:20 AS builder
WORKDIR /usr/src/app

# Define o ambiente como 'development' para garantir a instalação das devDependencies.
ENV NODE_ENV development

COPY package*.json ./
COPY prisma ./prisma/

# Instala todas as dependências, incluindo as de desenvolvimento.
RUN npm install

COPY . .
RUN npx prisma generate
RUN npm run build

# Debugging: List contents of dist folder
# Remove as dependências de desenvolvimento da pasta node_modules.
RUN npm prune --production


# ---- Estágio 2: Produção ----
FROM node:20
WORKDIR /usr/src/app

# Configura o ambiente para produção, otimizando performance e segurança.
ENV NODE_ENV production

COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/prisma ./prisma

# Expõe a porta que a aplicação irá rodar.
EXPOSE 3000

# Comando para iniciar a aplicação.
CMD ["npm", "run", "start:migrate:prod"]

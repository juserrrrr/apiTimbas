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


# ---- Estágio 2: Produção ----
FROM node:20
WORKDIR /usr/src/app

# Configura o ambiente para produção, otimizando performance e segurança.
ENV NODE_ENV production

# Copia os package.json e package-lock.json do estágio de build.
COPY --from=builder /usr/src/app/package*.json ./

# Instala apenas as dependências de produção.
RUN npm install --only=production

# Copia o código compilado e o schema do prisma.
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/prisma ./prisma

# Comando para iniciar a aplicação.
CMD ["node", "dist/main"]


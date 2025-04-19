#!/bin/sh

# Executa os comandos do Prisma
echo "Executando prisma db push..."
npx prisma db push

echo "Executando prisma db seed..."
npx prisma db seed

# Inicia a aplicação
echo "Iniciando a aplicação..."
node dist/main.js 
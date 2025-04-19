import { PrismaClient } from '@prisma/client';
import { Role } from '../src/enums/role.enum';
import * as bcrypt from 'bcrypt';

if (
  !process.env.ADMIN_NAME ||
  !process.env.ADMIN_EMAIL ||
  !process.env.ADMIN_PASSWORD ||
  !process.env.ADMIN_DISCORD_ID
) {
  throw new Error(
    'Variáveis de ambiente para o admin não foram definidas. Verifique seu arquivo .env',
  );
}

async function bootstrap() {
  const prisma = new PrismaClient();

  try {
    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, salt);

    const admin = await prisma.user.upsert({
      where: {
        email: process.env.ADMIN_EMAIL,
      },
      update: {
        name: process.env.ADMIN_NAME,
        discordId: process.env.ADMIN_DISCORD_ID,
        password: hashedPassword,
        role: Role.ADMIN,
      },
      create: {
        name: process.env.ADMIN_NAME,
        email: process.env.ADMIN_EMAIL,
        discordId: process.env.ADMIN_DISCORD_ID,
        password: hashedPassword,
        role: Role.ADMIN,
      },
    });

    console.log('Admin criado/atualizado:', {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      discordId: admin.discordId,
    });
  } catch (error) {
    console.error('Erro ao criar admin:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});

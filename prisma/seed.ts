import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { UserService } from '../src/user/user.service';
import { Role } from '../src/enums/role.enum';

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
  const app = await NestFactory.createApplicationContext(AppModule);
  const userService = app.get(UserService);

  try {
    const admin = await userService.create({
      name: process.env.ADMIN_NAME,
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
      discordId: process.env.ADMIN_DISCORD_ID,
      role: Role.ADMIN,
      dateOfBirth: null,
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
    await app.close();
  }
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});

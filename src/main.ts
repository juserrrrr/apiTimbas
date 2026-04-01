import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { Role } from './enums/role.enum';
import * as bcrypt from 'bcrypt';

async function seedAdmin(prisma: PrismaService) {
  const { ADMIN_DISCORD_ID, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_DISCORD_ID || !ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) return;

  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, await bcrypt.genSalt());

  await prisma.user.upsert({
    where: { discordId: ADMIN_DISCORD_ID },
    update: { name: ADMIN_NAME, email: ADMIN_EMAIL, password: hashedPassword, role: Role.ADMIN },
    create: { discordId: ADMIN_DISCORD_ID, name: ADMIN_NAME, email: ADMIN_EMAIL, password: hashedPassword, role: Role.ADMIN },
  });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe());
  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3001',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  await seedAdmin(app.get(PrismaService));

  const port = process.env.PORT || 3000;
  await app.listen(port);
}
bootstrap();

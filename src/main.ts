import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { Role } from './enums/role.enum';
import * as bcrypt from 'bcrypt';
import * as cookieParser from 'cookie-parser';

async function seedAdmin(prisma: PrismaService) {
  const { ADMIN_DISCORD_ID, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } =
    process.env;
  if (!ADMIN_DISCORD_ID || !ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD)
    return;

  const hashedPassword = await bcrypt.hash(
    ADMIN_PASSWORD,
    await bcrypt.genSalt(),
  );

  await prisma.user.upsert({
    where: { discordId: ADMIN_DISCORD_ID },
    update: {
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      password: hashedPassword,
      role: Role.ADMIN,
    },
    create: {
      discordId: ADMIN_DISCORD_ID,
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      password: hashedPassword,
      role: Role.ADMIN,
    },
  });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self';",
    );
    next();
  });

  // CORS - be specific about allowed origins
  const allowedOrigins = [process.env.WEB_URL || 'http://localhost:3000'];
  if (process.env.EXTRA_ALLOWED_ORIGINS) {
    allowedOrigins.push(...process.env.EXTRA_ALLOWED_ORIGINS.split(','));
  }

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await seedAdmin(app.get(PrismaService));

  const port = process.env.PORT || 3000;
  await app.listen(port);
}
bootstrap();

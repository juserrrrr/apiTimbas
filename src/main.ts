import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { Role } from './enums/role.enum';
import * as bcrypt from 'bcrypt';
import * as cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';

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
  app.use(json({ limit: '6mb' }));
  app.use(urlencoded({ extended: true, limit: '6mb' }));

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
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    // Sem isso o Chrome guarda o preflight por 5 segundos, então cada chamada
    // com Authorization pagava um OPTIONS antes do request de verdade: duas
    // idas e voltas em vez de uma. 24h é o teto que o Chrome aceita.
    maxAge: 86_400,
  });

  await seedAdmin(app.get(PrismaService));

  const port = process.env.PORT || 3000;
  const server = await app.listen(port);

  // O padrão do Node é fechar a conexão ociosa em 5s. O proxy na frente segura
  // a dele por mais tempo, então de vez em quando ele reaproveitava uma conexão
  // que o Node já estava fechando: request perdido, reconexão, latência. Manter
  // o servidor mais paciente que o proxy resolve, e headersTimeout precisa
  // ficar acima do keepAlive.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
}
bootstrap();

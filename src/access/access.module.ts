import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { PermissionGuard } from './permission.guard';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AccessController],
  providers: [AccessService, PermissionGuard],
  exports: [AccessService, PermissionGuard],
})
export class AccessModule {}

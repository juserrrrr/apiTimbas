import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [PrismaModule, AuthModule, AccessModule],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class EconomyModule {}

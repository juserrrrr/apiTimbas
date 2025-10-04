import { forwardRef, Module } from '@nestjs/common';
import { LeagueMatchController } from './leagueMatch.controller';
import { LeagueMatchService } from './leagueMatch.service';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UserService } from '../user/user.service';

@Module({
  imports: [PrismaModule, UserModule, AuthModule],
  controllers: [LeagueMatchController],
  providers: [LeagueMatchService, UserService],
  exports: [LeagueMatchService],
})
export class LeagueMatchModule {}

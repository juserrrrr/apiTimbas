import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { LeagueMatchController } from './leagueMatch.controller';
import { LeagueMatchService } from './leagueMatch.service';
import { UserModule } from 'src/user/user.module';
import { UserService } from 'src/user/user.service';

@Module({
  imports: [PrismaModule, forwardRef(() => AuthModule), UserModule],
  controllers: [LeagueMatchController],
  providers: [LeagueMatchService, UserService],
  exports: [LeagueMatchService],
})
export class LeagueMatchModule {}

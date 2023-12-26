import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { LeagueMatchController } from './leagueMatch.controller';
import { leagueMatchService } from './leagueMatch.service';

@Module({
  imports: [PrismaModule, forwardRef(() => AuthModule)],
  controllers: [LeagueMatchController],
  providers: [leagueMatchService],
  exports: [leagueMatchService],
})
export class LeagueMatchModule {}

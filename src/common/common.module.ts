import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ActorService } from './actor.service';
import { CacheBusService } from './cache-bus.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [ActorService, CacheBusService],
  exports: [ActorService, CacheBusService],
})
export class CommonModule {}

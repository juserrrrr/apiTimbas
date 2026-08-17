import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ActorService } from './actor.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [ActorService],
  exports: [ActorService],
})
export class CommonModule {}

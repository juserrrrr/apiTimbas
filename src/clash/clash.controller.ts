import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ClashService } from './clash.service';
import { AuthGuard } from '../auth/guards/auth.guard';

@UseGuards(AuthGuard)
@Controller('clash')
export class ClashController {
  constructor(private readonly clashService: ClashService) {}

  @Get('scout')
  async scout(
    @Query('gameName') gameName: string,
    @Query('tagLine') tagLine: string,
  ) {
    if (!gameName || !tagLine) throw new BadRequestException('gameName e tagLine são obrigatórios');
    return this.clashService.scout(gameName, tagLine);
  }
}

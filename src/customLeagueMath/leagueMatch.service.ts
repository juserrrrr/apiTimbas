import { PrismaService } from 'src/prisma/prisma.service';

export class leagueMatchService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createLeagueMatchDto: CreateLeagueMatchDto) {}

  async findAll() {}

  async findOne(id: string) {}

  async update(id: string, updateLeagueMatchDto: UpdateLeagueMatchDto) {}

  async remove(id: string) {}
}

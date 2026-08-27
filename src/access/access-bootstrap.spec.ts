import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AccessModule } from './access.module';
import { CommonModule } from '../common/common.module';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionGuard } from './permission.guard';
import { PrismaService } from '../prisma/prisma.service';

/// O bootstrap junta permissões e flags, e para isso AccessModule e
/// FeatureFlagsModule passaram a se importar. O teste existe para o ciclo de
/// forwardRef não voltar quebrado em runtime, coisa que o build não pega.
describe('GET /admin/access/bootstrap', () => {
  it('devolve permissões e flags ligadas numa resposta só', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          discordId: 'discord-7',
          name: 'Timba',
          role: 'PLAYER',
          avatar: null,
          status: 'APPROVED',
          statusNote: null,
          groups: [{ group: { permissions: ['dashboard.live'] } }],
        }),
      },
      platformSettings: { findUnique: jest.fn().mockResolvedValue({ id: 1, defaultPermissions: [] }) },
      featureFlag: {
        findMany: jest.fn().mockResolvedValue([
          { key: 'screen_share', enabled: true, description: null, updatedAt: null },
          { key: 'dashboard_clash', enabled: false, description: null, updatedAt: null },
        ]),
      },
    };

    const module = await Test.createTestingModule({ imports: [CommonModule, AccessModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().tokenPayload = { discordId: 'discord-7' };
          return true;
        },
      })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const app = module.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer()).get('/admin/access/bootstrap');

    expect(response.status).toBe(200);
    expect(response.body.permissions).toContain('dashboard.live');
    expect(response.body.features).toEqual(['screen_share']);

    await app.close();
  });
});

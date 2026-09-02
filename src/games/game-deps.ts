import type { AccessService } from '../access/access.service';
import type { ActorService } from '../common/actor.service';
import type { AuthService } from '../auth/auth.service';
import type { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import type { PrismaService } from '../prisma/prisma.service';

/// As salas do Colyseus são criadas pelo próprio framework, não pelo container
/// do Nest, então elas não recebem nada por construtor. Este arquivo é a única
/// costura entre os dois mundos: o módulo preenche uma vez no boot e a sala lê.
/// Um lugar só, para ninguém sair puxando serviço do Nest de dentro do jogo.

export interface GameDeps {
  auth: AuthService;
  actor: ActorService;
  access: AccessService;
  featureFlags: FeatureFlagsService;
  prisma: PrismaService;
}

let deps: GameDeps | null = null;

export function setGameDeps(next: GameDeps) {
  deps = next;
}

export function gameDeps(): GameDeps {
  if (!deps) throw new Error('Servidor de jogos não inicializado.');
  return deps;
}

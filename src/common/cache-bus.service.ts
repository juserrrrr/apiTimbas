import { Injectable } from '@nestjs/common';

export interface CachedIdentity {
  id?: number;
  discordId?: string | null;
}

/**
 * Ponto único para derrubar os caches de identidade e permissão.
 *
 * Os caches vivem dentro de cada service, mas quem muda o acesso de alguém
 * (aprovar, bloquear, trocar de grupo, mexer nas permissões padrão) está em
 * outro módulo. Em vez de cada service conhecer o outro, todos registram aqui
 * como esquecer um usuário e como esquecer todo mundo.
 */
@Injectable()
export class CacheBusService {
  private readonly listeners: {
    forget: (identity: CachedIdentity) => void;
    forgetAll: () => void;
  }[] = [];

  register(forget: (identity: CachedIdentity) => void, forgetAll: () => void) {
    this.listeners.push({ forget, forgetAll });
  }

  /// O acesso deste usuário mudou: a próxima requisição dele volta ao banco.
  forget(identity: CachedIdentity) {
    for (const listener of this.listeners) listener.forget(identity);
  }

  /// Mudou algo que vale para muita gente, como um grupo ou a base de
  /// permissões da plataforma.
  forgetAll() {
    for (const listener of this.listeners) listener.forgetAll();
  }
}

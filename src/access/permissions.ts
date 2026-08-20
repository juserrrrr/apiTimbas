/// Catálogo de permissões da plataforma. A API é a fonte da verdade: grupo só
/// guarda chaves que existem aqui, e o painel monta a tela a partir desta lista.
export const PERMISSION_CATEGORIES = [
  {
    id: 'competicoes',
    title: 'Competições',
    permissions: [
      { key: 'tournament.create', label: 'Criar campeonato', hint: 'Abre campeonato novo e vira dono dele' },
      { key: 'tournament.manageAny', label: 'Gerir qualquer campeonato', hint: 'Edita, inicia e apaga campeonato de outro dono' },
      { key: 'draft.create', label: 'Criar liga de draft', hint: 'Abre liga nova e vira dono dela' },
      { key: 'draft.manageAny', label: 'Gerir qualquer liga', hint: 'Edita, inicia e apaga liga de outro dono' },
    ],
  },
  {
    id: 'base',
    title: 'Base de jogadores',
    permissions: [
      { key: 'catalog.manage', label: 'Gerir a base', hint: 'Competições, times, jogadores, atributos e import' },
      { key: 'catalog.simulate', label: 'Rodadas da base', hint: 'Liga e desliga a simulação das competições' },
    ],
  },
  {
    id: 'plataforma',
    title: 'Plataforma',
    permissions: [
      { key: 'users.approve', label: 'Aprovar acesso', hint: 'Libera ou bloqueia quem entrou pelo Discord' },
      { key: 'users.manage', label: 'Gerir usuários', hint: 'Muda cargo e grupos de outra pessoa' },
      { key: 'groups.manage', label: 'Gerir grupos', hint: 'Cria grupo e escolhe as permissões dele' },
      { key: 'ai.manage', label: 'Gerir a IA', hint: 'Escolhe provedor, modelo e liga cada recurso' },
      { key: 'economy.manage', label: 'Gerir moedas', hint: 'Ajusta saldo da carteira de conta' },
      { key: 'demo.manage', label: 'Laboratório', hint: 'Gera e apaga dados de teste' },
      { key: 'features.manage', label: 'Gerir recursos', hint: 'Liga e desliga funcionalidades da plataforma' },
      { key: 'stream.broadcast', label: 'Transmitir tela', hint: 'Abre transmissão ao vivo para quem tiver o link' },
    ],
  },
] as const;

export const ALL_PERMISSIONS: string[] = PERMISSION_CATEGORIES.flatMap((category) =>
  category.permissions.map((permission) => permission.key),
);

export function isKnownPermission(key: string): boolean {
  return ALL_PERMISSIONS.includes(key);
}

/// Filtra o que veio de fora e tira repetido, para o grupo nunca guardar chave
/// inventada.
export function sanitizePermissions(keys: string[]): string[] {
  return [...new Set(keys.filter(isKnownPermission))];
}

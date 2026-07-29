import { PostMatchService } from './post-match.service';

describe('PostMatchService - votação de MVP', () => {
  const winners = [
    { userId: 1, discordId: 'winner-1', name: 'Vencedor Um' },
    { userId: 2, discordId: 'winner-2', name: 'Vencedor Dois' },
  ];
  const allPlayers = [
    ...winners,
    { userId: 3, discordId: 'loser-1', name: 'Perdedor Um' },
    { userId: 4, discordId: 'loser-2', name: 'Perdedor Dois' },
  ];

  function makeMessage(voterDiscordId: string, votedUserId: number) {
    const handlers: Record<string, (...args: any[]) => any> = {};
    const collector = {
      on: jest.fn((event: string, handler: (...args: any[]) => any) => {
        handlers[event] = handler;
        if (event === 'end') {
          setImmediate(() => {
            void handlers.collect({
              user: { id: voterDiscordId },
              values: [String(votedUserId)],
              update: jest.fn().mockResolvedValue(undefined),
              deferUpdate: jest.fn().mockResolvedValue(undefined),
            });
          });
        }
        return collector;
      }),
      stop: jest.fn(() => handlers.end?.()),
    };

    return {
      createMessageComponentCollector: jest.fn(() => collector),
      edit: jest.fn().mockResolvedValue(undefined),
    };
  }

  it('envia o texto e o select por DM para todos e salva um MVP do time vencedor', async () => {
    const choices = new Map([
      ['winner-1', 1],
      ['winner-2', 1],
      ['loser-1', 2],
      ['loser-2', 1],
    ]);
    const sentPayloads: any[] = [];
    const messages: any[] = [];

    const client = {
      users: {
        fetch: jest.fn(async (discordId: string) => ({
          send: jest.fn(async (payload: any) => {
            sentPayloads.push(payload);
            const message = makeMessage(discordId, choices.get(discordId)!);
            messages.push(message);
            return message;
          }),
        })),
      },
    };
    const prisma = {
      customLeagueMatch: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const leaderboardService = { invalidateServer: jest.fn() };

    const service = new PostMatchService(
      prisma as any,
      client as any,
      {} as any,
      {} as any,
      leaderboardService as any,
    );

    await (service as any).runMvpVote(77, 'server-1', winners, allPlayers);

    expect(client.users.fetch).toHaveBeenCalledTimes(allPlayers.length);
    expect(sentPayloads).toHaveLength(allPlayers.length);
    for (const payload of sentPayloads) {
      expect(payload).toEqual({
        content: 'Quem foi o MVP da partida #77?',
        components: expect.any(Array),
      });
      const json = payload.components[0].toJSON();
      expect(json.components[0].options.map((option: any) => option.value)).toEqual(['1', '2']);
      expect(json.components[0].options.map((option: any) => option.value)).not.toContain('3');
      expect(json.components[0].options.map((option: any) => option.value)).not.toContain('4');
    }
    expect(prisma.customLeagueMatch.update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { mvpUserId: 1 },
    });
    expect(leaderboardService.invalidateServer).toHaveBeenCalledWith('server-1');
    for (const message of messages) {
      expect(message.edit).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'O MVP da partida #77 foi Vencedor Um, com 3 voto(s).',
        }),
      );
    }
  });

  it('não abre votação quando há somente um vencedor', async () => {
    const client = { users: { fetch: jest.fn() } };
    const service = new PostMatchService(
      {} as any,
      client as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await (service as any).runMvpVote(78, 'server-1', [winners[0]], [winners[0], allPlayers[2]]);

    expect(client.users.fetch).not.toHaveBeenCalled();
  });
});

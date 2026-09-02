import { GameTicketsService } from './game-tickets.service';

describe('GameTicketsService', () => {
  it('emite um ticket de uso único para a identidade', () => {
    const tickets = new GameTicketsService();
    const ticket = tickets.issue('discord-1');

    expect(tickets.consume(ticket)).toBe('discord-1');
    expect(tickets.consume(ticket)).toBeNull();
  });

  it('recusa ticket ausente ou vencido', () => {
    const tickets = new GameTicketsService();
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const ticket = tickets.issue('discord-1');
    now.mockReturnValue(61_001);

    expect(tickets.consume()).toBeNull();
    expect(tickets.consume(ticket)).toBeNull();
    now.mockRestore();
  });
});

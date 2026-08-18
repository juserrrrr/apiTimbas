import { parseMoney, parseSquadHtml } from './sofifa.service';

/// Mesmo formato da listagem do SoFIFA em pt-BR: as colunas trocam de ordem
/// conforme o que se pede, e o cabeçalho é quem diz o que é cada uma.
const page = (rows: string) => `
<table>
  <thead>
    <tr>
      <th></th><th>Nome</th><th>Classificação Geral</th><th>Time &amp; Contrato</th>
      <th>ID</th><th>Valor</th>
      <th>Ritmo / Elasticidade</th><th>Finaliz. / Manejo</th><th>Passes / Chute</th>
      <th>Condução / Reflexos</th><th>Defesa / Ritmo</th><th>Físico / Posicionamento</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;

const row = (
  name: string,
  positions: string[],
  cells: Array<string | number>,
) => `
  <tr>
    <td class="a1"><figure></figure></td>
    <td>
      <a href="/player/277643/lamine-yamal/260046/">${name}</a>
      ${positions.map((position) => `<span class="pos pos15">${position}</span>`).join(' ')}
    </td>
    ${cells.map((cell) => `<td>${cell}</td>`).join('')}
  </tr>`;

describe('parseSquadHtml', () => {
  it('lê nota, posição, valor e os seis atributos pelo cabeçalho', () => {
    const html = page(
      row('Lamine Yamal', ['PD', 'MD'], [89, 'FC Barcelona 2022 ~ 2031', 277643, '€147M', 86, 84, 87, 91, 25, 61]),
    );

    expect(parseSquadHtml(html)).toEqual([
      {
        sofifaId: '277643',
        name: 'Lamine Yamal',
        position: 'PD',
        overall: 89,
        value: 147_000_000,
        attributes: { pace: 86, shooting: 84, passing: 87, dribbling: 91, defending: 25, physical: 61 },
      },
    ]);
  });

  it('traduz a posição de goleiro e a meia aberta do site', () => {
    const html = page(
      row('Joan García', ['GL'], [86, 'FC Barcelona', 259532, '€72.5M', 85, 85, 80, 88, 46, 84]) +
        row('Fulano', ['ME'], [75, 'FC Barcelona', 1, '€1M', 70, 70, 70, 70, 70, 70]),
    );

    expect(parseSquadHtml(html).map((player) => player.position)).toEqual(['GOL', 'PE']);
  });

  it('deixa o card nulo quando falta atributo e não repete jogador', () => {
    const html = page(
      row('Fulano', ['ATA'], [80, 'Time', 2, '€5M', 70, 70, 70, 70, 70, '']) +
        row('Fulano', ['ATA'], [80, 'Time', 2, '€5M', 70, 70, 70, 70, 70, 70]),
    );

    const players = parseSquadHtml(html);
    expect(players).toHaveLength(1);
    expect(players[0].attributes).toBeNull();
  });

  it('devolve lista vazia quando a página não tem tabela', () => {
    expect(parseSquadHtml('<html><body>login</body></html>')).toEqual([]);
  });
});

describe('parseMoney', () => {
  it('lê milhão, mil e valor cheio', () => {
    expect(parseMoney('€147M')).toBe(147_000_000);
    expect(parseMoney('€72.5M')).toBe(72_500_000);
    expect(parseMoney('€900K')).toBe(900_000);
    expect(parseMoney('€500')).toBe(500);
  });

  it('devolve null quando não tem valor', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('€0')).toBeNull();
  });
});

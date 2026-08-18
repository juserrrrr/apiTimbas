import { parseJsonObject, readResponsesOutput, unsupportedParamFrom } from './chat.client';

const refusal = (status: number, message: string) => ({
  response: { status, data: { error: { message } } },
});

describe('unsupportedParamFrom', () => {
  it('reconhece o modelo que quer max_completion_tokens', () => {
    expect(
      unsupportedParamFrom(
        refusal(
          400,
          "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
        ),
      ),
    ).toBe('max_tokens');
  });

  it('reconhece o modelo que recusa temperature', () => {
    expect(
      unsupportedParamFrom(
        refusal(400, "Unsupported value: 'temperature' does not support 0 with this model."),
      ),
    ).toBe('temperature');
  });

  it('ignora erro de chave e de cota, que não falam de formato', () => {
    expect(unsupportedParamFrom(refusal(401, 'Missing scopes: model.request'))).toBeNull();
    expect(unsupportedParamFrom(refusal(429, 'Rate limit reached'))).toBeNull();
  });

  it('ignora 400 que não é sobre parâmetro conhecido', () => {
    expect(unsupportedParamFrom(refusal(400, 'The model `nao-existe` does not exist'))).toBeNull();
  });
});

describe('parseJsonObject', () => {
  it('lê o objeto embrulhado em cerca de código', () => {
    expect(parseJsonObject('```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it('lê o objeto quando o modelo fala antes dele', () => {
    expect(parseJsonObject('Claro! {"ok":true}')).toEqual({ ok: true });
  });

  it('devolve null para texto sem objeto e para lista', () => {
    expect(parseJsonObject('sem json aqui')).toBeNull();
    expect(parseJsonObject('[1,2,3]')).toBeNull();
  });
});

describe('readResponsesOutput', () => {
  it('usa o atalho output_text', () => {
    expect(readResponsesOutput({ output_text: '{"ok":true}' })).toBe('{"ok":true}');
  });

  it('junta o texto dos itens e pula o raciocínio', () => {
    const data = {
      output: [
        { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'pensando' }] },
        {
          type: 'message',
          content: [
            { type: 'output_text', text: '{"ok"' },
            { type: 'output_text', text: ':true}' },
          ],
        },
      ],
    };
    expect(readResponsesOutput(data)).toBe('{"ok":true}');
  });

  it('devolve vazio quando não veio saída legível', () => {
    expect(readResponsesOutput({})).toBe('');
    expect(readResponsesOutput({ output: [{ type: 'reasoning' }] })).toBe('');
  });
});

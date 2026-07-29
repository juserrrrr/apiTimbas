import * as fs from 'fs';
import * as path from 'path';
import {
  getExistingQueueGifUrl,
  getQueueGifAttachment,
  QUEUE_GIF_ATTACHMENT_NAME,
  QUEUE_GIF_PATH,
} from './queue-gif.helper';

describe('queue-gif.helper', () => {
  it('deve achar o gif da fila no repositório', () => {
    expect(fs.existsSync(QUEUE_GIF_PATH)).toBe(true);
  });

  it('deve devolver o anexo com o nome que o embed referencia', () => {
    // O embed usa setImage('attachment://timbas.gif'); se o nome do anexo
    // divergir, a imagem não renderiza mesmo com o arquivo presente.
    expect(getQueueGifAttachment()).toEqual({
      attachment: QUEUE_GIF_PATH,
      name: QUEUE_GIF_ATTACHMENT_NAME,
    });
    expect(QUEUE_GIF_ATTACHMENT_NAME).toBe('timbas.gif');
  });

  it('deve devolver null quando o arquivo não existe, em vez de quebrar', () => {
    const spy = jest.spyOn(fs, 'existsSync').mockReturnValue(false);

    expect(getQueueGifAttachment()).toBeNull();

    spy.mockRestore();
  });

  it('a pasta images precisa ser copiada para a imagem final do Docker', () => {
    // Foi exatamente essa a causa do gif sumir em produção: o arquivo estava
    // versionado, mas o estágio runner do Dockerfile não copiava images/.
    const dockerfile = fs.readFileSync(path.join(process.cwd(), 'Dockerfile'), 'utf8');
    const runnerStage = dockerfile.slice(dockerfile.lastIndexOf('AS runner'));

    expect(runnerStage).toMatch(/COPY\s+--from=builder\s+\/app\/images\s+\.\/images/);
  });

  it('deve reutilizar a URL CDN do gif ao editar a mensagem', () => {
    const message = {
      attachments: {
        find: (predicate: (attachment: any) => boolean) =>
          [
            {
              name: QUEUE_GIF_ATTACHMENT_NAME,
              url: 'https://cdn.discordapp.com/attachments/timbas.gif',
            },
          ].find(predicate),
      },
    };

    const url = getExistingQueueGifUrl(message);

    expect(url).toBe('https://cdn.discordapp.com/attachments/timbas.gif');
    expect(url).not.toBe(`attachment://${QUEUE_GIF_ATTACHMENT_NAME}`);
  });
});

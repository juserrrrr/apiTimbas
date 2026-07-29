import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Gif da fila usado nos embeds de partida.
 *
 * O arquivo é lido em runtime de `process.cwd()/images`, então precisa estar
 * na imagem final do Docker (ver o COPY de `images` no Dockerfile). Quando
 * falta, o embed sai sem imagem; por isso o aviso no log, que é o que faltou
 * para perceber a ausência mais cedo.
 */
const logger = new Logger('QueueGif');

/** Nome do anexo referenciado pelo embed via `attachment://`. */
export const QUEUE_GIF_ATTACHMENT_NAME = 'timbas.gif';

export const QUEUE_GIF_PATH = path.join(process.cwd(), 'images', 'timbasQueueGif.gif');

let warned = false;

export function getQueueGifAttachment(): { attachment: string; name: string } | null {
  if (!fs.existsSync(QUEUE_GIF_PATH)) {
    if (!warned) {
      warned = true;
      logger.warn(`Gif da fila não encontrado em ${QUEUE_GIF_PATH}; os embeds vão sair sem imagem.`);
    }
    return null;
  }
  return { attachment: QUEUE_GIF_PATH, name: QUEUE_GIF_ATTACHMENT_NAME };
}

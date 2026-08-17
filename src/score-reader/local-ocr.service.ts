import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createWorker, type Worker } from 'tesseract.js';
import { tmpdir } from 'os';
import { join } from 'path';

const IDLE_SHUTDOWN_MS = 5 * 60 * 1000;

@Injectable()
export class LocalOcrService implements OnModuleDestroy {
  private readonly logger = new Logger(LocalOcrService.name);
  private worker: Worker | null = null;
  private workerLanguage = '';
  private starting: Promise<Worker> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  async read(imageBase64: string, mimeType: string, language: string): Promise<string> {
    const worker = await this.workerFor(language);
    const { data } = await worker.recognize(`data:${mimeType};base64,${imageBase64}`);
    this.scheduleShutdown();
    return data.text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  async onModuleDestroy() {
    await this.shutdown();
  }

  private async workerFor(language: string): Promise<Worker> {
    if (this.worker && this.workerLanguage === language) return this.worker;
    if (this.starting) return this.starting;

    this.starting = this.spawn(language);
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async spawn(language: string): Promise<Worker> {
    await this.shutdown();
    this.logger.log(`Iniciando OCR local (${language}); o modelo é baixado uma vez e fica em cache.`);

    const worker = await createWorker(language, undefined, {
      cachePath: process.env.OCR_CACHE_PATH || join(tmpdir(), 'timbas-tesseract'),
      logger: () => undefined,
    });

    this.worker = worker;
    this.workerLanguage = language;
    return worker;
  }

  /// O worker do Tesseract segura uns 100MB. Como leitura de placar é
  /// esporádica, ele é encerrado depois de um tempo parado e sobe de novo
  /// no próximo uso.
  private scheduleShutdown() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.shutdown(), IDLE_SHUTDOWN_MS);
    this.idleTimer.unref();
  }

  private async shutdown() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (!this.worker) return;
    const worker = this.worker;
    this.worker = null;
    this.workerLanguage = '';
    await worker.terminate().catch(() => undefined);
  }
}

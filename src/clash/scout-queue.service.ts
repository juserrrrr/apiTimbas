import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ClashService, ScoutProgress } from './clash.service';

export type ScoutJobStatus = 'queued' | 'running' | 'done' | 'error';

export interface ScoutJobView {
  id: string;
  riotId: string;
  status: ScoutJobStatus;
  deep: boolean;
  queuePosition: number;
  progress: ScoutProgress;
  result?: any;
  error?: string;
  analysisId?: string;
  createdAt: number;
  finishedAt?: number;
}

interface ScoutJobInternal {
  id: string;
  riotKey: string;
  gameName: string;
  tagLine: string;
  deep: boolean;
  status: ScoutJobStatus;
  progress: ScoutProgress;
  result?: any;
  error?: string;
  analysisId?: string;
  createdAt: number;
  finishedAt?: number;
}

// Jobs finalizados ficam disponíveis por 1h para o frontend buscar o resultado
// mesmo que o usuário tenha saído da tela.
const JOB_RETENTION_MS = 60 * 60 * 1000;
// Scout repetido do mesmo jogador dentro dessa janela reaproveita o resultado
// pronto em vez de gastar o rate limit da Riot de novo.
const RESULT_REUSE_MS = 5 * 60 * 1000;

// Fila FIFO em memória com concorrência 1: um scout consome ~100+ chamadas à
// Riot (limite Personal: 100 req/2min), então rodar um por vez garante que
// cada job termina o mais rápido possível e nenhum dado é descartado — o
// RiotService já aguarda o rate limit liberar em vez de falhar.
@Injectable()
export class ScoutQueueService {
  private readonly logger = new Logger(ScoutQueueService.name);
  private readonly jobs = new Map<string, ScoutJobInternal>();
  private readonly pending: string[] = [];
  private processing = false;

  constructor(private readonly clashService: ClashService) {}

  enqueue(gameName: string, tagLine: string, deep = false): ScoutJobView {
    this.prune();
    // deep e normal são resultados diferentes — não dedupe entre eles
    const riotKey = `${gameName}#${tagLine}`.toLowerCase() + (deep ? ':deep' : ':std');

    for (const job of this.jobs.values()) {
      if (job.riotKey !== riotKey) continue;
      if (job.status === 'queued' || job.status === 'running') return this.view(job);
      if (job.status === 'done' && Date.now() - (job.finishedAt ?? 0) < RESULT_REUSE_MS) {
        return this.view(job);
      }
    }

    const job: ScoutJobInternal = {
      id: randomUUID(),
      riotKey,
      gameName,
      tagLine,
      deep,
      status: 'queued',
      progress: { stage: 'queued', message: 'Na fila, aguardando a vez...', percent: 0 },
      createdAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    this.pending.push(job.id);
    void this.pump();
    return this.view(job);
  }

  getJob(id: string): ScoutJobView {
    this.prune();
    const job = this.jobs.get(id);
    if (!job) throw new NotFoundException('Análise não encontrada ou expirada. Faça a busca novamente.');
    return this.view(job);
  }

  private async pump(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      for (;;) {
        const id = this.pending.shift();
        if (!id) break;
        const job = this.jobs.get(id);
        if (!job || job.status !== 'queued') continue;

        job.status = 'running';
        job.progress = { stage: 'starting', message: 'Iniciando scout...', percent: 1 };
        this.logger.log(`Iniciando scout de ${job.gameName}#${job.tagLine} (job ${job.id})`);
        try {
          job.result = await this.clashService.scout(
            job.gameName,
            job.tagLine,
            (p) => {
              job.progress = p;
            },
            job.deep,
          );
          job.status = 'done';
          job.progress = { stage: 'done', message: 'Análise concluída!', percent: 100 };
          // Auto-save para o histórico — falha aqui não derruba o scout
          try {
            const saved = await this.clashService.saveAnalysis({
              ...job.result,
              meta: { searchedRiotId: `${job.gameName}#${job.tagLine}`, deep: job.deep },
            });
            job.analysisId = saved.id;
          } catch (err) {
            this.logger.warn(`Falha ao salvar análise no histórico: ${(err as any)?.message}`);
          }
        } catch (err) {
          job.status = 'error';
          job.error = (err as any)?.response?.message ?? (err as any)?.message ?? 'Erro ao buscar dados do time';
          this.logger.warn(`Scout de ${job.riotKey} falhou: ${job.error}`);
        } finally {
          job.finishedAt = Date.now();
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private view(job: ScoutJobInternal): ScoutJobView {
    return {
      id: job.id,
      riotId: `${job.gameName}#${job.tagLine}`,
      status: job.status,
      deep: job.deep,
      queuePosition: job.status === 'queued' ? this.pending.indexOf(job.id) + 1 : 0,
      progress: job.progress,
      result: job.status === 'done' ? job.result : undefined,
      error: job.error,
      analysisId: job.analysisId,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
    };
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      const isFinished = job.status === 'done' || job.status === 'error';
      if (isFinished && now - (job.finishedAt ?? job.createdAt) > JOB_RETENTION_MS) {
        this.jobs.delete(id);
      }
    }
  }
}

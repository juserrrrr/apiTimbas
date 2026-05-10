import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { createHash } from 'crypto';

const GEMINI_CACHE_TTL_MS = 30 * 60 * 1000;
const GEMINI_FALLBACK_CACHE_TTL_MS = 2 * 60 * 1000;
const GEMINI_MAX_RETRIES = 1;
const GEMINI_MAX_RETRY_DELAY_MS = 65_000;

// ─── Input types ─────────────────────────────────────────────────────────────

export interface MasteryChamp {
  championId: number;
  championName: string;
  masteryLevel: number;
  masteryPoints: number;
}

export interface QueueChampStat {
  championId: number;
  championName: string;
  games: number;
  wins: number;
  winrate: number;
  kda: number;
}

export interface RoleStat {
  role: string;
  games: number;
  share: number;
}

export interface PlaystyleStats {
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgDamageToChampions: number;
  avgVisionScore: number;
  avgKillParticipation: number;
  avgTeamDragons: number;
  avgTeamBarons: number;
  avgDragonTakedowns: number;
  avgObjectiveSteals: number;
  avgEnemyJungleMonsterKills: number;
}

export interface QueuePerf {
  games: number;
  winrate: number;
  avgKda: number;
  topChampions: QueueChampStat[];
  roleDistribution: RoleStat[];
  playstyle: PlaystyleStats;
}

export interface FullPlayerData {
  riotId: string;
  position: string;
  soloRank: { tier: string; rank: string; lp: number; wins: number; losses: number };
  flexRank: { tier: string; rank: string; lp: number; wins: number; losses: number };
  soloSeasonWinrate: number;
  flexSeasonWinrate: number;
  masteryTop10: MasteryChamp[];
  soloQueue: QueuePerf;    // last 20 — peso maior
  flexQueue: QueuePerf;    // last 10
  clashHistory: QueuePerf; // last 10
  combinedTopChamps: QueueChampStat[];
}

// ─── Output types ─────────────────────────────────────────────────────────────

export interface BanSuggestion {
  championId: number;
  championName: string;
  targetPlayer: string;
  reason: string;
  priority: number;
}

export interface CounterplayAdvice {
  riotId: string;
  position: string;
  likelyPick: string;
  howToCounter: string;
  keyThreats: string[];
}

export interface PredictedPick {
  riotId: string;
  position: string;
  option1: { champion: string; reason: string };
  option2: { champion: string; reason: string };
}

export interface AiAnalysis {
  bans: BanSuggestion[];
  counterplays: CounterplayAdvice[];
  predictedPicks: PredictedPick[];
  strategy: string;
}

export interface PlayerProfileAnalysis {
  summary: string;
  fightPattern: string;
  objectivePattern: string;
  riskPattern: string;
  mapPattern: string;
  tips: string[];
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly geminiApiKey: string | null;
  private readonly geminiModel: string;
  private readonly analysisCache = new Map<string, { value: AiAnalysis; expiresAt: number }>();
  private readonly profileAnalysisCache = new Map<string, { value: PlayerProfileAnalysis; expiresAt: number }>();
  private geminiBlockedUntil = 0;

  constructor() {
    this.geminiApiKey = process.env.GEMINI_API_KEY || null;
    this.geminiModel = (process.env.GEMINI_MODEL || 'gemini-2.0-flash').replace(/^models\//, '');
    if (!this.geminiApiKey) this.logger.warn('GEMINI_API_KEY não configurado — análise de IA desabilitada');
    this.logger.log(`AiService ready — model=${this.geminiModel}`);
  }

  async analyzeOpponents(players: FullPlayerData[]): Promise<AiAnalysis> {
    const empty: AiAnalysis = { bans: [], counterplays: [], predictedPicks: [], strategy: '' };
    if (!this.geminiApiKey) {
      return { ...empty, strategy: 'Configure GEMINI_API_KEY para ativar análise de IA.' };
    }
    const cacheKey = this.buildAnalysisCacheKey(players);
    const cached = this.getCachedAnalysis(cacheKey);
    if (cached) return cached;

    const expectedPlayers = players.length;
    const expectedBans = Math.min(10, Math.max(5, expectedPlayers * 2));

    const prompt = `Você é um analista profissional de League of Legends especializado em Clash. Analise os dados dos 5 jogadores adversários e gere uma análise tática precisa, orientada para draft.

DADOS DOS ADVERSÁRIOS (JSON):
${JSON.stringify(
  players.map((p) => ({
    riotId: p.riotId,
    clashPosition: p.position,
    roleEvidence: {
      observacao: 'Se clashPosition for TOP/JUNGLE/MID/ADC/SUPPORT, trate como rota principal. Use histórico recente apenas para desempatar picks e risco de flex.',
      soloQueueRoles: p.soloQueue.roleDistribution,
      flexQueueRoles: p.flexQueue.roleDistribution,
      clashRoles: p.clashHistory.roleDistribution,
    },
    soloRank: `${p.soloRank.tier} ${p.soloRank.rank} (${p.soloRank.wins}W/${p.soloRank.losses}L — ${p.soloSeasonWinrate}% WR season)`,
    flexRank: `${p.flexRank.tier} ${p.flexRank.rank} (${p.flexSeasonWinrate}% WR season)`,
    maestria_top5: p.masteryTop10.slice(0, 5).map((m) => `${m.championName} M${m.masteryLevel}`),
    soloQueue_recente: {
      games: p.soloQueue.games,
      winrate: `${p.soloQueue.winrate}%`,
      kdaMedio: p.soloQueue.avgKda,
      estilo: this.formatPlaystyle(p.soloQueue.playstyle, p.position),
      topChamps: p.soloQueue.topChampions.slice(0, 5).map((c) => `${c.championName} (${c.games}G ${c.winrate}% WR ${c.kda} KDA)`),
    },
    flexQueue_recente: {
      games: p.flexQueue.games,
      winrate: `${p.flexQueue.winrate}%`,
      kdaMedio: p.flexQueue.avgKda,
      estilo: this.formatPlaystyle(p.flexQueue.playstyle, p.position),
      topChamps: p.flexQueue.topChampions.slice(0, 3).map((c) => `${c.championName} (${c.games}G ${c.winrate}% WR)`),
    },
    clash_historico: {
      games: p.clashHistory.games,
      kdaMedio: p.clashHistory.avgKda,
      estilo: this.formatPlaystyle(p.clashHistory.playstyle, p.position),
      topChamps: p.clashHistory.topChampions.slice(0, 3).map((c) => `${c.championName} (${c.games}G ${c.winrate}% WR)`),
    },
    campeons_combinados_top5: p.combinedTopChamps.slice(0, 5).map((c) => `${c.championName} (${c.games}G ${c.winrate}% WR)`),
  })),
  null,
  2,
)}

Responda APENAS com JSON válido, sem markdown, sem texto fora do JSON:
{
  "bans": [
    {
      "championId": 0,
      "championName": "string",
      "targetPlayer": "riotId do alvo",
      "reason": "string (máx 120 chars, português)",
      "priority": 1
    }
  ],
  "counterplays": [
    {
      "riotId": "string",
      "position": "clashPosition quando vier TOP/JUNGLE/MID/ADC/SUPPORT; caso contrário rota mais provável ou FLEX",
      "likelyPick": "campeão que ele provavelmente vai pegar",
      "howToCounter": "como jogar contra esse jogador/pick (máx 150 chars, português)",
      "keyThreats": ["ameaça1", "ameaça2", "ameaça3"]
    }
  ],
  "predictedPicks": [
    {
      "riotId": "string",
      "position": "clashPosition quando vier TOP/JUNGLE/MID/ADC/SUPPORT; caso contrário rota mais provável ou FLEX",
      "option1": { "champion": "string", "reason": "string (máx 80 chars, português)" },
      "option2": { "champion": "string", "reason": "string (máx 80 chars, português)" }
    }
  ],
  "strategy": "Resumo da estratégia geral do time adversário em 2-3 frases (português)"
}

Regras:
- Use os campos "estilo" para explicar mortes, lutas, dano, visao, drag/baron, invade e roubo de objetivo.
- Para JUNGLE, pese mais dragoes/baroes do time, dragon takedowns, objective steals e enemy jungle monster kills.
- Gere exatamente ${expectedBans} bans, prioridade 1 a ${expectedBans} (sem repetir campeões)
- Se clashPosition for TOP, JUNGLE, MID, ADC ou SUPPORT, use essa rota como a rota principal do jogador.
- Só inferir rota por histórico recente quando clashPosition estiver ausente, FILL, UNSELECTED ou inválida.
- Se clashPosition vier válido mas o histórico recente divergir, mantenha clashPosition e trate a divergência como risco de flex no motivo.
- Para bans, priorize campeões com alta confiança de rota + alta ameaça: winrate > 60% com >= 5 jogos, presença em Clash, maestria alta, KDA forte e repetição em filas recentes.
- Não bana um campeão só por maestria se ele não aparece em jogos recentes, a menos que seja ameaça clara e sem alternativa melhor.
- Soloqueue pesa mais para forma mecânica; Clash/Flex pesam mais para draft coordenado e rota provável.
- predictedPicks: os 2 campeões mais prováveis caso o ban principal não atinja o jogador
- counterplays: uma entrada por jogador recebido (${expectedPlayers} total)
- predictedPicks: uma entrada por jogador recebido (${expectedPlayers} total)
- Seja específico e acionável, não genérico
- Use termos curtos em português nos motivos: "mono recente", "alta taxa de vitória", "rota provável MID", "flexível no draft"`;

    try {
      const response = await this.postGeminiWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent`,
        {
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
            responseSchema: this.analysisSchema(),
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.geminiApiKey,
          },
          timeout: 30000,
          transformResponse: [(data: string) => data],
        },
      );

      let responseData: any;
      try {
        responseData = JSON.parse(response.data as string);
      } catch {
        this.logger.warn(`[AI] Resposta HTTP inválida (não-JSON) — raw=${String(response.data).slice(0, 200)}`);
        const fallback = this.buildStatAnalysis(players, 'Gemini retornou resposta inválida; análise gerada pelos dados recentes.');
        this.setCachedAnalysis(cacheKey, fallback, GEMINI_FALLBACK_CACHE_TTL_MS);
        return fallback;
      }

      const text = responseData?.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? '').join('') ?? '';
      const finishReason = responseData?.candidates?.[0]?.finishReason ?? 'unknown';
      this.logger.log(`[AI] finishReason=${finishReason} | chars=${text.length} | preview=${text.slice(0, 300).replace(/\n/g, ' ')}`);
      const analysis = this.parseAnalysis(text, players);
      this.setCachedAnalysis(cacheKey, analysis, GEMINI_CACHE_TTL_MS);
      return analysis;
    } catch (err) {
      this.logger.warn(`Erro ao chamar IA para análise: ${this.describeGeminiError(err)}`);
      const fallback = this.buildStatAnalysis(players, 'Gemini indisponível; análise gerada pelos dados recentes.');
      this.setCachedAnalysis(cacheKey, fallback, GEMINI_FALLBACK_CACHE_TTL_MS);
      return fallback;
    }
  }

  async analyzePlayerProfile(player: FullPlayerData): Promise<PlayerProfileAnalysis> {
    const cacheKey = this.buildProfileAnalysisCacheKey(player);
    const cached = this.profileAnalysisCache.get(cacheKey);
    if (cached && Date.now() <= cached.expiresAt) return cached.value;
    if (!this.geminiApiKey) return this.buildPlayerProfileFallback(player, 'Gemini indisponivel; leitura gerada por dados recentes.');

    const payload = {
      riotId: player.riotId,
      position: player.position,
      soloRank: `${player.soloRank.tier} ${player.soloRank.rank} ${player.soloRank.lp} LP`,
      flexRank: `${player.flexRank.tier} ${player.flexRank.rank} ${player.flexRank.lp} LP`,
      soloQueue: this.profileQueuePayload(player.soloQueue),
      flexQueue: this.profileQueuePayload(player.flexQueue),
      clashHistory: this.profileQueuePayload(player.clashHistory),
      combinedTopChamps: player.combinedTopChamps.slice(0, 10),
      note: 'Gank lane exata (top/mid/bot) exige match timeline; com estes dados, inferir apenas estilo geral e objetivos.',
    };

    const prompt = `Analise o estilo de jogo deste jogador de League of Legends para um perfil individual.
Use os dados recentes para dizer como ele joga: lutas, mortes, dano, visao, objetivos, jungle invade/roubo se for jungler.
Nao invente lane de gank exata; se nao houver timeline, diga que o foco de gank e inconclusivo.

DADOS:
${JSON.stringify(payload, null, 2)}

Responda APENAS JSON valido:
{
  "summary": "resumo em 1 frase",
  "fightPattern": "como luta/participa de fights",
  "objectivePattern": "como joga objetivos, drag/baron/visao",
  "riskPattern": "onde se expoe/morre mais ou se joga seguro",
  "mapPattern": "leitura de mapa, invade/gank/foco de rota quando houver evidência",
  "tips": ["dica curta 1", "dica curta 2", "dica curta 3"]
}`;

    try {
      const response = await this.postGeminiWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent`,
        {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json',
            responseSchema: this.playerProfileAnalysisSchema(),
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.geminiApiKey,
          },
          timeout: 30000,
          transformResponse: [(data: string) => data],
        },
      );

      const responseData = JSON.parse(response.data as string);
      const text = responseData?.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? '').join('') ?? '';
      this.logger.log(`[AI] profile chars=${text.length} | preview=${text.slice(0, 300).replace(/\n/g, ' ')}`);
      const analysis = this.parsePlayerProfileAnalysis(text, player);
      this.profileAnalysisCache.set(cacheKey, { value: analysis, expiresAt: Date.now() + GEMINI_CACHE_TTL_MS });
      return analysis;
    } catch (err) {
      this.logger.warn(`Erro ao chamar IA para perfil: ${this.describeGeminiError(err)}`);
      const fallback = this.buildPlayerProfileFallback(player, 'Leitura gerada pelos dados recentes.');
      this.profileAnalysisCache.set(cacheKey, { value: fallback, expiresAt: Date.now() + GEMINI_FALLBACK_CACHE_TTL_MS });
      return fallback;
    }
  }

  private async postGeminiWithRetry(url: string, body: any, config: any): Promise<any> {
    const waitFromPrevious429 = this.geminiBlockedUntil - Date.now();
    if (waitFromPrevious429 > 0 && waitFromPrevious429 <= GEMINI_MAX_RETRY_DELAY_MS) {
      this.logger.warn(`[AI] Gemini em cooldown; aguardando ${Math.ceil(waitFromPrevious429 / 1000)}s`);
      await this.wait(waitFromPrevious429);
    } else if (waitFromPrevious429 > GEMINI_MAX_RETRY_DELAY_MS) {
      throw new Error(`Gemini em cooldown por ${Math.ceil(waitFromPrevious429 / 1000)}s`);
    }

    for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
      try {
        return await axios.post(url, body, config);
      } catch (err) {
        const status = (err as any)?.response?.status;
        const retryDelayMs = this.getGeminiRetryDelayMs(err);
        if (status !== 429 || attempt === GEMINI_MAX_RETRIES || retryDelayMs > GEMINI_MAX_RETRY_DELAY_MS) {
          throw err;
        }

        this.geminiBlockedUntil = Date.now() + retryDelayMs;
        this.logger.warn(`[AI] Gemini 429; aguardando ${Math.ceil(retryDelayMs / 1000)}s antes de tentar novamente`);
        await this.wait(retryDelayMs);
      }
    }

    throw new Error('Gemini request failed');
  }

  private getGeminiRetryDelayMs(err: unknown): number {
    const data = this.getGeminiErrorData(err);
    const retryDelay = data?.error?.details?.find((d: any) => d?.['@type']?.includes('RetryInfo'))?.retryDelay;
    const fromDetails = this.parseDurationMs(retryDelay);
    if (fromDetails) return fromDetails;

    const message = String(data?.error?.message ?? '');
    const match = message.match(/retry in\s+([\d.]+)s/i);
    if (match) return Math.ceil(Number(match[1]) * 1000);

    const retryAfter = (err as any)?.response?.headers?.['retry-after'];
    const retryAfterValue = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
    const retryAfterSeconds = Number(retryAfterValue);
    return Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : 60_000;
  }

  private parseDurationMs(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const match = value.match(/^([\d.]+)s$/);
    if (!match) return null;
    const seconds = Number(match[1]);
    return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : null;
  }

  private describeGeminiError(err: unknown): string {
    const status = (err as any)?.response?.status;
    const data = this.getGeminiErrorData(err);
    const code = data?.error?.status;
    const retryMs = status === 429 ? this.getGeminiRetryDelayMs(err) : null;
    const message = String(data?.error?.message ?? (err as any)?.message ?? 'erro desconhecido')
      .replace(/\s+/g, ' ')
      .slice(0, 240);
    return `status=${status ?? 'n/a'} code=${code ?? 'n/a'}${retryMs ? ` retry=${Math.ceil(retryMs / 1000)}s` : ''} msg=${message}`;
  }

  private getGeminiErrorData(err: unknown): any {
    const data = (err as any)?.response?.data;
    if (typeof data !== 'string') return data;
    try {
      return JSON.parse(data);
    } catch {
      return { error: { message: data } };
    }
  }

  private buildAnalysisCacheKey(players: FullPlayerData[]): string {
    const payload = players.map((p) => ({
      riotId: p.riotId,
      position: p.position,
      solo: p.soloQueue.topChampions.slice(0, 5),
      flex: p.flexQueue.topChampions.slice(0, 3),
      clash: p.clashHistory.topChampions.slice(0, 3),
      combined: p.combinedTopChamps.slice(0, 5),
    }));
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private buildProfileAnalysisCacheKey(player: FullPlayerData): string {
    return createHash('sha256').update(JSON.stringify({
      riotId: player.riotId,
      position: player.position,
      solo: this.profileQueuePayload(player.soloQueue),
      flex: this.profileQueuePayload(player.flexQueue),
      clash: this.profileQueuePayload(player.clashHistory),
      combined: player.combinedTopChamps.slice(0, 10),
    })).digest('hex');
  }

  private profileQueuePayload(queue: QueuePerf) {
    return {
      games: queue.games,
      winrate: queue.winrate,
      avgKda: queue.avgKda,
      playstyle: queue.playstyle,
      roles: queue.roleDistribution,
      topChampions: queue.topChampions.slice(0, 8),
    };
  }

  private getCachedAnalysis(key: string): AiAnalysis | null {
    const cached = this.analysisCache.get(key);
    if (!cached) return null;
    if (Date.now() > cached.expiresAt) {
      this.analysisCache.delete(key);
      return null;
    }
    this.logger.log('[AI] usando análise em cache');
    return cached.value;
  }

  private setCachedAnalysis(key: string, value: AiAnalysis, ttlMs: number): void {
    this.analysisCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private formatPlaystyle(stats: PlaystyleStats, position: string): string {
    const values = [
      `${stats.avgDeaths} mortes/jogo`,
      `${stats.avgKillParticipation}% KP`,
      `${stats.avgDamageToChampions} dano em campeoes/jogo`,
      `${stats.avgVisionScore} visao/jogo`,
    ];

    if (position?.toUpperCase() === 'JUNGLE') {
      values.push(
        `${stats.avgTeamDragons} dragoes do time/jogo`,
        `${stats.avgTeamBarons} baroes do time/jogo`,
        `${stats.avgDragonTakedowns} dragon takedowns/jogo`,
        `${stats.avgObjectiveSteals} roubos de objetivo/jogo`,
        `${stats.avgEnemyJungleMonsterKills} monstros da jungle inimiga/jogo`,
      );
    }

    return values.join('; ');
  }

  private stripJsonFence(text: string): string {
    return text
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  private parseAnalysis(text: string, players: FullPlayerData[]): AiAnalysis {
    const stripped = this.stripJsonFence(text);
    try {
      return JSON.parse(stripped) as AiAnalysis;
    } catch {
      const start = stripped.indexOf('{');
      const end = stripped.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(stripped.slice(start, end + 1)) as AiAnalysis;
        } catch {
          return this.buildStatAnalysis(players, 'Gemini retornou JSON inválido; análise gerada pelos dados recentes.');
        }
      }
      return this.buildStatAnalysis(players, 'Gemini retornou JSON inválido; análise gerada pelos dados recentes.');
    }
  }

  private parsePlayerProfileAnalysis(text: string, player: FullPlayerData): PlayerProfileAnalysis {
    const stripped = this.stripJsonFence(text);
    try {
      return this.normalizePlayerProfileAnalysis(JSON.parse(stripped), player);
    } catch {
      const start = stripped.indexOf('{');
      const end = stripped.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return this.normalizePlayerProfileAnalysis(JSON.parse(stripped.slice(start, end + 1)), player);
        } catch {
          return this.buildPlayerProfileFallback(player, 'Leitura gerada pelos dados recentes.');
        }
      }
      return this.buildPlayerProfileFallback(player, 'Leitura gerada pelos dados recentes.');
    }
  }

  private normalizePlayerProfileAnalysis(value: any, player: FullPlayerData): PlayerProfileAnalysis {
    const fallback = this.buildPlayerProfileFallback(player, 'Analise gerada pelos dados recentes.');
    return {
      summary: this.cleanText(value?.summary) || fallback.summary,
      fightPattern: this.cleanText(value?.fightPattern) || fallback.fightPattern,
      objectivePattern: this.cleanText(value?.objectivePattern) || fallback.objectivePattern,
      riskPattern: this.cleanText(value?.riskPattern) || fallback.riskPattern,
      mapPattern: this.cleanText(value?.mapPattern) || fallback.mapPattern,
      tips: Array.isArray(value?.tips)
        ? value.tips.map((tip: unknown) => this.cleanText(tip)).filter(Boolean).slice(0, 3)
        : fallback.tips,
    };
  }

  private cleanText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private buildPlayerProfileFallback(player: FullPlayerData, prefix: string): PlayerProfileAnalysis {
    const bestQueue = [player.soloQueue, player.flexQueue, player.clashHistory].sort((a, b) => b.games - a.games)[0];
    const style = bestQueue.playstyle;
    const mainChamp = player.combinedTopChamps[0]?.championName ?? player.masteryTop10[0]?.championName ?? 'sem campeao claro';
    const objective = player.position === 'JUNGLE'
      ? `${style.avgTeamDragons} dragoes/time por jogo, ${style.avgObjectiveSteals} roubos e ${style.avgEnemyJungleMonsterKills} camps inimigos/jogo.`
      : `${style.avgVisionScore} visao/jogo e ${style.avgKillParticipation}% KP; objetivos dependem mais do time.`;

    return {
      summary: `${prefix} Perfil tende a jogar em torno de ${mainChamp}, com ${bestQueue.avgKda} KDA medio e ${style.avgDeaths} mortes/jogo.`,
      fightPattern: `${style.avgKillParticipation}% KP, ${style.avgDamageToChampions} dano em campeoes/jogo e ${style.avgKills}/${style.avgDeaths}/${style.avgAssists} KDA bruto medio.`,
      objectivePattern: objective,
      riskPattern: style.avgDeaths >= 6 ? 'Morre bastante; pode ser punido em fights longas ou entradas sem visao.' : 'Morre pouco/moderado; tende a preservar recursos e escolher melhor as lutas.',
      mapPattern: player.position === 'JUNGLE'
        ? 'Foco de gank por rota fica inconclusivo sem timeline, mas os numeros indicam pressao por objetivos/invade quando altos.'
        : 'Foco de mapa por rota fica inconclusivo sem timeline; use KP, visao e campeoes para inferir presenca em fights.',
      tips: [
        'Negue campeoes de conforto mais recentes.',
        'Force visao antes de objetivos neutros.',
        style.avgDeaths >= 6 ? 'Acelere picks quando ele entrar sem informacao.' : 'Evite entregar lutas curtas favoraveis.',
      ],
    };
  }

  private buildStatAnalysis(players: FullPlayerData[], strategyPrefix: string): AiAnalysis {
    const threats = players.flatMap((player) =>
      player.combinedTopChamps.slice(0, 5).map((champ) => ({
        ...champ,
        player,
        score: champ.games * 3 + champ.winrate + champ.kda * 4 + (player.clashHistory.topChampions.some((c) => c.championId === champ.championId) ? 25 : 0),
      })),
    );

    const usedChampionIds = new Set<number>();
    const bans: BanSuggestion[] = [];
    for (const threat of threats.sort((a, b) => b.score - a.score)) {
      if (bans.length >= Math.min(10, Math.max(5, players.length * 2))) break;
      if (usedChampionIds.has(threat.championId)) continue;
      usedChampionIds.add(threat.championId);
      bans.push({
        championId: threat.championId,
        championName: threat.championName,
        targetPlayer: threat.player.riotId,
        reason: `${threat.games} jogos recentes, ${threat.winrate}% WR e ${threat.kda} KDA`,
        priority: bans.length + 1,
      });
    }

    const counterplays: CounterplayAdvice[] = players.map((player) => {
      const likely = player.combinedTopChamps[0] ?? player.soloQueue.topChampions[0] ?? player.masteryTop10[0];
      return {
        riotId: player.riotId,
        position: player.position,
        likelyPick: likely?.championName ?? 'Flex',
        howToCounter: likely
          ? `Pressione a rota ${player.position} e negue conforto no ${likely.championName}.`
          : `Poucos dados recentes; jogue por visão e force escolhas cedo na rota ${player.position}.`,
        keyThreats: player.combinedTopChamps.slice(0, 3).map((c) => c.championName),
      };
    });

    const predictedPicks: PredictedPick[] = players.map((player) => {
      const picks = player.combinedTopChamps.length ? player.combinedTopChamps : player.soloQueue.topChampions;
      return {
        riotId: player.riotId,
        position: player.position,
        option1: {
          champion: picks[0]?.championName ?? 'Flex',
          reason: picks[0] ? `${picks[0].games} jogos recentes` : 'Sem amostra recente clara',
        },
        option2: {
          champion: picks[1]?.championName ?? picks[0]?.championName ?? 'Flex',
          reason: picks[1] ? `${picks[1].winrate}% WR recente` : 'Alternativa por histórico disponível',
        },
      };
    });

    const playerCount = players.length;
    const strategy = `${strategyPrefix} ${playerCount} jogador(es) processado(s). Priorize bans nos campeões com mais jogos, maior winrate e presença em Clash/Flex; trate rotas divergentes como possibilidade de flex no draft.`;

    return { bans, counterplays, predictedPicks, strategy };
  }

  private analysisSchema() {
    return {
      type: 'OBJECT',
      properties: {
        bans: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              championId: { type: 'INTEGER' },
              championName: { type: 'STRING' },
              targetPlayer: { type: 'STRING' },
              reason: { type: 'STRING' },
              priority: { type: 'INTEGER' },
            },
            required: ['championId', 'championName', 'targetPlayer', 'reason', 'priority'],
          },
        },
        counterplays: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              riotId: { type: 'STRING' },
              position: { type: 'STRING' },
              likelyPick: { type: 'STRING' },
              howToCounter: { type: 'STRING' },
              keyThreats: { type: 'ARRAY', items: { type: 'STRING' } },
            },
            required: ['riotId', 'position', 'likelyPick', 'howToCounter', 'keyThreats'],
          },
        },
        predictedPicks: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              riotId: { type: 'STRING' },
              position: { type: 'STRING' },
              option1: {
                type: 'OBJECT',
                properties: {
                  champion: { type: 'STRING' },
                  reason: { type: 'STRING' },
                },
                required: ['champion', 'reason'],
              },
              option2: {
                type: 'OBJECT',
                properties: {
                  champion: { type: 'STRING' },
                  reason: { type: 'STRING' },
                },
                required: ['champion', 'reason'],
              },
            },
            required: ['riotId', 'position', 'option1', 'option2'],
          },
        },
        strategy: { type: 'STRING' },
      },
      required: ['bans', 'counterplays', 'predictedPicks', 'strategy'],
    };
  }

  private playerProfileAnalysisSchema() {
    return {
      type: 'OBJECT',
      properties: {
        summary: { type: 'STRING' },
        fightPattern: { type: 'STRING' },
        objectivePattern: { type: 'STRING' },
        riskPattern: { type: 'STRING' },
        mapPattern: { type: 'STRING' },
        tips: {
          type: 'ARRAY',
          items: { type: 'STRING' },
        },
      },
      required: ['summary', 'fightPattern', 'objectivePattern', 'riskPattern', 'mapPattern', 'tips'],
    };
  }
}

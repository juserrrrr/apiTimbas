import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

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

export interface QueuePerf {
  games: number;
  winrate: number;
  avgKda: number;
  topChampions: QueueChampStat[];
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
  priority: 1 | 2 | 3 | 4 | 5;
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

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly geminiApiKey: string | null;
  private readonly geminiModel: string;

  constructor() {
    this.geminiApiKey = process.env.GEMINI_API_KEY || null;
    this.geminiModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').replace(/^models\//, '');
    if (!this.geminiApiKey) this.logger.warn('GEMINI_API_KEY não configurado — análise de IA desabilitada');
  }

  async analyzeOpponents(players: FullPlayerData[]): Promise<AiAnalysis> {
    const empty: AiAnalysis = { bans: [], counterplays: [], predictedPicks: [], strategy: '' };
    if (!this.geminiApiKey) {
      return { ...empty, strategy: 'Configure GEMINI_API_KEY para ativar análise de IA.' };
    }

    const prompt = `Você é um analista profissional de League of Legends especializado em Clash. Analise os dados completos dos 5 jogadores adversários e gere uma análise tática detalhada.

DADOS DOS ADVERSÁRIOS (JSON):
${JSON.stringify(
  players.map((p) => ({
    riotId: p.riotId,
    position: p.position,
    soloRank: `${p.soloRank.tier} ${p.soloRank.rank} (${p.soloRank.wins}W/${p.soloRank.losses}L — ${p.soloSeasonWinrate}% WR season)`,
    flexRank: `${p.flexRank.tier} ${p.flexRank.rank} (${p.flexSeasonWinrate}% WR season)`,
    maestria_top5: p.masteryTop10.slice(0, 5).map((m) => `${m.championName} M${m.masteryLevel}`),
    soloQueue_recente: {
      games: p.soloQueue.games,
      winrate: `${p.soloQueue.winrate}%`,
      topChamps: p.soloQueue.topChampions.slice(0, 5).map((c) => `${c.championName} (${c.games}G ${c.winrate}% WR ${c.kda} KDA)`),
    },
    flexQueue_recente: {
      games: p.flexQueue.games,
      winrate: `${p.flexQueue.winrate}%`,
      topChamps: p.flexQueue.topChampions.slice(0, 3).map((c) => `${c.championName} (${c.games}G ${c.winrate}% WR)`),
    },
    clash_historico: {
      games: p.clashHistory.games,
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
      "position": "string",
      "likelyPick": "campeão que ele provavelmente vai pegar",
      "howToCounter": "como jogar contra esse jogador/pick (máx 150 chars, português)",
      "keyThreats": ["ameaça1", "ameaça2", "ameaça3"]
    }
  ],
  "predictedPicks": [
    {
      "riotId": "string",
      "position": "string",
      "option1": { "champion": "string", "reason": "string (máx 80 chars, português)" },
      "option2": { "champion": "string", "reason": "string (máx 80 chars, português)" }
    }
  ],
  "strategy": "Resumo da estratégia geral do time adversário em 2-3 frases (português)"
}

Regras:
- Exatamente 5 bans, prioridade 1 a 5 (sem repetir campeões)
- Priorize: winrate > 60% com >= 5 jogos, campeões de Clash, maestria alta
- Soloqueue tem peso 2x maior que flex para determinar picks prováveis
- predictedPicks: os 2 campeões mais prováveis caso os bans não o atinjam
- counterplays: uma entrada por jogador (5 total)
- predictedPicks: uma entrada por jogador (5 total)
- Seja específico e acionável, não genérico`;

    try {
      const response = await axios.post(
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
            maxOutputTokens: 2000,
            responseMimeType: 'application/json',
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.geminiApiKey,
          },
          timeout: 30000,
        },
      );

      const text = response.data?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
      return JSON.parse(this.stripJsonFence(text)) as AiAnalysis;
    } catch (err) {
      this.logger.error('Erro ao chamar IA para análise', err);
      return { ...empty, strategy: 'Erro ao gerar análise. Tente novamente.' };
    }
  }

  private stripJsonFence(text: string): string {
    return text
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }
}

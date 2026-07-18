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

export interface MapRegionStats {
  top: number;
  mid: number;
  bot: number;
  alliedJungle: number;
  enemyJungle: number;
  river: number;
  unknown: number;
}

export interface MapProfile {
  games: number;
  earlyPresence: MapRegionStats;
  fightRegions: MapRegionStats;
  deathRegions: MapRegionStats;
  objectiveFights: number;
  invades: number;
  startSide: string; // 'topo' | 'baixo' | 'inconclusivo' — lado do 1º clear
  earlyGanksPerGame: number; // kills/assists em lanes antes dos 14min, por jogo
  mostVisited: string;
  mostFought: string;
  mostDeaths: string;
  likelyGankFocus: string;
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
  mapProfile?: MapProfile;
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

export interface ThreatAssessment {
  riotId: string;
  position: string;
  level: number; // 1 (fraco) a 5 (ameaça extrema)
  reason: string;
}

export interface GamePlan {
  winCondition: string;
  earlyGame: string;
  teamfight: string;
  damageProfile: string;
  focusTarget: string; // riotId do carry a focar
  weakLink: string; // riotId do elo fraco a explorar
  threats: ThreatAssessment[];
}

export interface AiAnalysis {
  bans: BanSuggestion[];
  counterplays: CounterplayAdvice[];
  predictedPicks: PredictedPick[];
  strategy: string;
  gamePlan?: GamePlan;
}

export interface PlayerProfileAnalysis {
  summary: string;
  fightPattern: string;
  objectivePattern: string;
  riskPattern: string;
  mapPattern: string;
  tips: string[];
}

export interface MatchRecapInput {
  matchId: number;
  matchTypeLabel: string;
  playersPerTeam: number;
  blueTeam: string[];
  redTeam: string[];
  winnerSide: 'BLUE' | 'RED';
  mvpName?: string | null;
  streakNotes?: string[];
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

CONTEXTO DO JOGO ATUAL (Season 2026 — use SEMPRE estas regras, não as de temporadas antigas):
- Minions nascem aos 0:30 e camps da jungle aos 0:55 — o early começa imediatamente; invade ainda existe mas exige commit logo no início do jogo, sem fase de espera no nível 1.
- Atakhan e Feats of Strength NÃO existem mais. Não os mencione.
- Baron nasce aos 20 minutos. First Blood dá 100g e primeira torre 300g — punir o elo fraco cedo paga mais.
- Turret plates são permanentes em todas as torres; pressão de split e demolição de torre valem mais.
- Role Quests: top ganha TP grátis, mid botas T3 grátis, bot 7º slot de botas e 200% crit base, suporte slot extra de control ward.
- A partir dos 14min as waves aceleram (25s) — tempos de rotação e reset ficaram mais curtos.

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
    campeoes_combinados_top10: p.combinedTopChamps.slice(0, 10).map((c) => `${c.championName} (${c.games}G ${c.winrate}% WR ${c.kda} KDA)`),
    mapa: p.mapProfile?.games
      ? {
          jogosAnalisados: p.mapProfile.games,
          rotaInicial: `costuma começar a jungle/jogo pelo lado ${p.mapProfile.startSide} do mapa`,
          ganksEarlyPorJogo: p.mapProfile.earlyGanksPerGame,
          presencaInicial: p.mapProfile.mostVisited,
          lutaMaisEm: p.mapProfile.mostFought,
          morreMaisEm: p.mapProfile.mostDeaths,
          focoGankPressao: p.mapProfile.likelyGankFocus,
          invades: p.mapProfile.invades,
          fightsDeObjetivo: p.mapProfile.objectiveFights,
        }
      : undefined,
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
  "strategy": "Resumo da estratégia geral do time adversário em 2-3 frases (português)",
  "gamePlan": {
    "winCondition": "como VENCER este time: 2-3 frases objetivas e acionáveis (português)",
    "earlyGame": "plano para os primeiros 5 minutos com tempos da Season 2026 (minions 0:30, camps 0:55): commit de invade sim/não logo no início, onde wardear antes de 0:55, qual lane proteger (máx 220 chars)",
    "teamfight": "como jogar as teamfights contra eles: quem focar, o que evitar (máx 200 chars)",
    "damageProfile": "perfil de dano provável da comp (AD/AP/misto) e dica de itemização defensiva (máx 160 chars)",
    "focusTarget": "riotId EXATO do jogador mais perigoso (o carry a focar/negar recursos)",
    "weakLink": "riotId EXATO do elo mais fraco (a lane a explorar/gankar)",
    "threats": [
      { "riotId": "string", "position": "string", "level": 3, "reason": "por que esse nível (máx 100 chars, português)" }
    ]
  }
}

Regras:
- gamePlan.threats: exatamente uma entrada por jogador, level de 1 (fraco) a 5 (ameaça extrema), baseado em rank, forma recente, pool de campeões e histórico de Clash.
- Na reason da threat de maior level, diga explicitamente que ele é quem carrega o time; na de menor level, que é o alvo a punir.
- gamePlan.focusTarget e weakLink devem ser riotIds exatos dos dados recebidos.
- Quando o campo "mapa" existir, use-o no earlyGame e no winCondition — é evidência real de timeline: rotaInicial diz por onde o jogador começa, ganksEarlyPorJogo mede o quanto o jungler ganka (>=2.5 é gank pesado, <1 é focado em farm/counter-jungle), focoGankPressao diz qual lane sofre mais.
- Para o JUNGLE adversário com mapa disponível, o earlyGame DEVE citar a rota inicial provável e qual lane deve wardear cedo.
- Bans devem ser baseados primeiro em PREDICT de pick provavel, nao em maior winrate isolado.
- Para prever pick, pese nesta ordem: campeoes repetidos nas partidas recentes da rota do Clash, campeoes jogados em Clash/Flex, volume recente em SoloQ, campeoes repetidos no campeoes_combinados_top10, e maestria apenas como desempate.
- Winrate alto aumenta prioridade somente quando o campeao tambem aparece recente ou faz sentido para a rota do Clash. Nao bana campeao de 1 jogo 100% WR acima de um comfort pick com mais volume.
- Se um campeao tem winrate ruim mas aparece muitas vezes recentemente e combina com a rota, trate como comfort pick provavel e considere ban se ele define o estilo do jogador.
- Cada jogador deve ter ao menos 1 ban candidato quando houver dados de campeao suficientes; os bans extras devem cobrir segundos picks provaveis ou flex picks reais.
- Para bans, explique o motivo com linguagem de predict: "pick recente", "comfort da rota", "aparece em Clash/Flex", "segundo pick provavel", "flex real", "bom desempenho recente".
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
      mapProfile: player.mapProfile,
      note: player.mapProfile?.games
        ? 'mapProfile foi calculado a partir de timelines recentes; use como sinal aproximado de presenca, fights, mortes, invade e foco de pressao.'
        : 'Sem timeline suficiente; nao invente foco de gank.',
    };

    const prompt = `Analise o estilo de jogo deste jogador de League of Legends para um perfil individual.
CONTEXTO: Season 2026 — minions nascem aos 0:30 e camps aos 0:55; invade exige commit imediato no início; Atakhan e Feats of Strength não existem mais; Baron aos 20min. Use apenas mecânicas atuais.
Use os dados recentes para dizer como ele joga: lutas, mortes, dano, visao, objetivos, jungle invade/roubo se for jungler.
Use mapProfile quando existir para falar onde ele aparece no mapa, onde luta, onde morre, por qual lado costuma começar (startSide), quantos ganks early faz por jogo (earlyGanksPerGame) e qual rota parece receber mais gank/pressao.
Se mapProfile.games for 0, diga que foco de gank e inconclusivo.

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

  /**
   * Gera um resumo curto e bem-humorado (pt-BR) de uma partida personalizada.
   * Sem dados de jogo da Riot — usa apenas times, vencedor, MVP e streaks.
   */
  async generateMatchRecap(input: MatchRecapInput): Promise<string> {
    const fallback = this.buildRecapFallback(input);
    if (!this.geminiApiKey) return fallback;

    const winnerNames = input.winnerSide === 'BLUE' ? input.blueTeam : input.redTeam;
    const loserNames = input.winnerSide === 'BLUE' ? input.redTeam : input.blueTeam;

    const prompt = `Você é o narrador zoeiro oficial de um servidor de Discord de amigos que jogam partidas personalizadas de League of Legends.
Escreva um resumo curto e engraçado (2 a 3 frases, máx 350 caracteres, português do Brasil, pode usar gíria de LoL e emoji) sobre a partida abaixo.
Zoe levemente os perdedores e exalte os vencedores, sem ofensas pesadas, sem palavrão.
Não invente estatísticas de jogo (kills, objetivos) — você não tem esses dados.

PARTIDA #${input.matchId} — ${input.matchTypeLabel} ${input.playersPerTeam}v${input.playersPerTeam}
Time vencedor (${input.winnerSide === 'BLUE' ? 'Azul 🔵' : 'Vermelho 🔴'}): ${winnerNames.join(', ')}
Time derrotado: ${loserNames.join(', ')}
${input.mvpName ? `MVP votado pela galera: ${input.mvpName}` : ''}
${input.streakNotes?.length ? `Fatos: ${input.streakNotes.join('; ')}` : ''}

Responda APENAS com o texto do resumo, sem aspas, sem markdown.`;

    try {
      const response = await this.postGeminiWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent`,
        {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.9, maxOutputTokens: 256 },
        },
        {
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.geminiApiKey },
          timeout: 20000,
          transformResponse: [(data: string) => data],
        },
      );
      const responseData = JSON.parse(response.data as string);
      const text: string = responseData?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('').trim() ?? '';
      return text ? text.slice(0, 500) : fallback;
    } catch (err) {
      this.logger.warn(`Erro ao gerar recap da partida: ${this.describeGeminiError(err)}`);
      return fallback;
    }
  }

  private buildRecapFallback(input: MatchRecapInput): string {
    const winnerLabel = input.winnerSide === 'BLUE' ? 'Time Azul 🔵' : 'Time Vermelho 🔴';
    const mvp = input.mvpName ? ` MVP da rodada: **${input.mvpName}**.` : '';
    return `O ${winnerLabel} levou a partida #${input.matchId} (${input.matchTypeLabel} ${input.playersPerTeam}v${input.playersPerTeam}).${mvp} GG WP! 🏆`;
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
      // deep scout (com timeline) gera análise diferente do scout normal
      mapGames: p.mapProfile?.games ?? 0,
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
      mapProfile: player.mapProfile,
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
    const map = player.mapProfile;
    const mainChamp = player.combinedTopChamps[0]?.championName ?? player.masteryTop10[0]?.championName ?? 'sem campeao claro';
    const secondaryChamp = player.combinedTopChamps[1]?.championName;
    const champPool = secondaryChamp ? `${mainChamp}/${secondaryChamp}` : mainChamp;
    const queueName = this.queueLabel(player, bestQueue);
    const topPositions = (player as any).topPositions as string[] | undefined;
    const roleText = topPositions?.length ? topPositions.join('/') : player.position;
    const mapSummary = map?.games
      ? ` Timeline: aparece mais em ${map.mostVisited}, luta mais em ${map.mostFought}, morre mais em ${map.mostDeaths} e pressiona ${map.likelyGankFocus}.`
      : '';
    const objective = player.position === 'JUNGLE'
      ? `${style.avgTeamDragons} dragoes/time por jogo, ${style.avgDragonTakedowns} dragon takedowns, ${style.avgObjectiveSteals} roubos e ${style.avgEnemyJungleMonsterKills} camps inimigos/jogo.${map?.games ? ` Timeline marcou ${map.invades} sinais de invade e ${map.objectiveFights} fights de objetivo.` : ''}`
      : `${style.avgVisionScore} visao/jogo, ${style.avgKillParticipation}% KP e ${style.avgTeamDragons} dragoes do time/jogo.${map?.games ? ` Timeline marcou ${map.objectiveFights} fights de objetivo.` : ''}`;
    const fightStyle = style.avgKillParticipation >= 55
      ? 'participa bastante das lutas'
      : style.avgKillParticipation >= 40
        ? 'entra em lutas selecionadas'
        : 'tem baixa participacao em kills e pode jogar mais lateral/isolado';
    const riskStyle = style.avgDeaths >= 6
      ? 'morre muito e costuma dar janela clara de punish'
      : style.avgDeaths >= 4
        ? 'morre em ritmo moderado; punir sem visao ainda funciona'
        : 'morre pouco e tende a escolher melhor quando entrar';

    return {
      summary: `${prefix} ${player.riotId} aparece como ${roleText}, com conforto recente em ${champPool}. Na amostra mais forte (${queueName}, ${bestQueue.games} jogos), ${fightStyle}: ${style.avgKillParticipation}% KP, ${style.avgDamageToChampions} dano/jogo, ${bestQueue.avgKda} KDA e ${style.avgDeaths} mortes/jogo.${mapSummary}`,
      fightPattern: `${fightStyle}: ${style.avgKillParticipation}% KP, ${style.avgDamageToChampions} dano em campeoes/jogo e ${style.avgKills}/${style.avgDeaths}/${style.avgAssists} K/A/D medio. Se estiver de ${mainChamp}, tende a escalar e brigar melhor quando tem espaco para DPS.`,
      objectivePattern: objective,
      riskPattern: `${riskStyle}. O ponto de punish mais claro e cortar visao antes de fight e forcar luta quando os campeoes de conforto estiverem sem setup.`,
      mapPattern: this.buildMapFallback(player),
      tips: [
        `Priorize negar ${mainChamp}${secondaryChamp ? ` ou ${secondaryChamp}` : ''} se o draft depender dele.`,
        map?.games ? `Prepare visao e cover no lado ${map.likelyGankFocus}, onde a timeline indica mais pressao.` : 'Prepare visao antes de objetivos neutros.',
        style.avgDeaths >= 6 ? 'Acelere picks quando ele entrar sem informacao.' : 'Force lutas com engage claro; nao entregue fight lenta de escala.',
      ],
    };
  }

  private queueLabel(player: FullPlayerData, queue: QueuePerf): string {
    if (queue === player.soloQueue) return 'SoloQ';
    if (queue === player.flexQueue) return 'Flex';
    if (queue === player.clashHistory) return 'Clash';
    return 'recente';
  }

  private buildMapFallback(player: FullPlayerData): string {
    const map = player.mapProfile;
    if (!map?.games) {
      return 'Sem timeline suficiente para mapear foco de rota; use campeoes, KP e visao como sinais secundarios.';
    }
    const base = `Presenca inicial maior em ${map.mostVisited}; lutas mais frequentes em ${map.mostFought}; mortes mais comuns em ${map.mostDeaths}.`;
    const startSide = map.startSide && map.startSide !== 'inconclusivo' ? ` Costuma comecar pelo lado ${map.startSide}.` : '';
    const jungle = player.position === 'JUNGLE'
      ? ` Foco provavel de gank/pressao: ${map.likelyGankFocus}; ${map.earlyGanksPerGame} ganks early/jogo, ${map.invades} sinais de invade e ${map.objectiveFights} fights de objetivo nas timelines.${startSide}`
      : ` Pressao de mapa mais clara: ${map.likelyGankFocus}; ${map.objectiveFights} fights de objetivo nas timelines.${startSide}`;
    return base + jungle;
  }

  private buildStatAnalysis(players: FullPlayerData[], strategyPrefix: string): AiAnalysis {
    const threats = players.flatMap((player) => this.buildPredictiveBanCandidates(player));

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
        reason: threat.reason,
        priority: bans.length + 1,
      });
    }

    const counterplays: CounterplayAdvice[] = players.map((player) => {
      const predicted = this.buildPredictiveBanCandidates(player);
      const likely = predicted[0] ?? player.combinedTopChamps[0] ?? player.soloQueue.topChampions[0] ?? player.masteryTop10[0];
      return {
        riotId: player.riotId,
        position: player.position,
        likelyPick: likely?.championName ?? 'Flex',
        howToCounter: likely
          ? `Pressione a rota ${player.position} e negue conforto no ${likely.championName}.`
          : `Poucos dados recentes; jogue por visão e force escolhas cedo na rota ${player.position}.`,
        keyThreats: predicted.slice(0, 3).map((c) => c.championName),
      };
    });

    const predictedPicks: PredictedPick[] = players.map((player) => {
      const picks = this.buildPredictiveBanCandidates(player);
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

    return { bans, counterplays, predictedPicks, strategy, gamePlan: this.buildStatGamePlan(players) };
  }

  // Plano de jogo por estatística pura — usado quando o Gemini está indisponível.
  private buildStatGamePlan(players: FullPlayerData[]): GamePlan | undefined {
    if (!players.length) return undefined;

    const scored = players
      .map((p) => ({
        p,
        score:
          this.tierScore(p.soloRank.tier, p.soloRank.rank) * 2 +
          Math.max(0, p.soloQueue.winrate - 45) * 0.5 +
          p.soloQueue.avgKda * 2 +
          (p.clashHistory.games > 0 ? 3 : 0),
      }))
      .sort((a, b) => b.score - a.score);

    const focus = scored[0].p;
    const weak = scored[scored.length - 1].p;
    const focusChamp = focus.combinedTopChamps[0]?.championName;
    const weakName = weak.riotId.split('#')[0];
    const focusName = focus.riotId.split('#')[0];
    const jungler = players.find((p) => p.position === 'JUNGLE');
    const gankFocus = jungler?.mapProfile?.games ? jungler.mapProfile.likelyGankFocus : null;

    return {
      winCondition: `Jogue o early em cima de ${weakName} (${weak.position}) e negue recursos a ${focusName} (${focus.position})${focusChamp ? `, principalmente no ${focusChamp}` : ''}. Aceleração de vantagem no lado fraco vence antes do carry escalar.`,
      earlyGame: gankFocus
        ? `Timeline indica que o jungler deles pressiona ${gankFocus}${jungler?.mapProfile?.startSide && jungler.mapProfile.startSide !== 'inconclusivo' ? ` e costuma começar pelo lado ${jungler.mapProfile.startSide}` : ''} — warde esse lado antes das 0:55 (camps da S2026) e puna o lado oposto.`
        : `Camps nascem às 0:55 e minions às 0:30 na S2026: warde as entradas da jungle até 0:50, evite trocas cegas no rio e jogue pelo lado de ${weakName}.`,
      teamfight: `Foque ${focusName} nas lutas; não gaste cooldowns na frontline enquanto ele estiver vivo.`,
      damageProfile: 'Sem leitura de IA do perfil de dano — confirme na tela de picks antes de fechar itemização defensiva.',
      focusTarget: focus.riotId,
      weakLink: weak.riotId,
      threats: scored.map(({ p }, i) => ({
        riotId: p.riotId,
        position: p.position,
        level: Math.max(1, 5 - i),
        reason: `${p.soloRank.tier} ${p.soloRank.rank}, ${p.soloQueue.winrate}% WR recente, ${p.soloQueue.avgKda} KDA${p.clashHistory.games ? ', experiência de Clash' : ''}`,
      })),
    };
  }

  private tierScore(tier: string, rank: string): number {
    const tiers = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
    const divisions: Record<string, number> = { IV: 0, III: 1, II: 2, I: 3 };
    const tierIndex = tiers.indexOf(tier?.toUpperCase());
    if (tierIndex < 0) return 0;
    return tierIndex * 4 + (divisions[rank?.toUpperCase()] ?? 0);
  }

  private buildPredictiveBanCandidates(player: FullPlayerData) {
    const candidates = new Map<number, QueueChampStat & { player: FullPlayerData; score: number; signals: string[] }>();

    const add = (champ: QueueChampStat, weight: number, signal: string) => {
      const existing = candidates.get(champ.championId);
      if (existing) {
        existing.games += champ.games;
        existing.wins += champ.wins;
        existing.kda = Math.max(existing.kda, champ.kda);
        existing.score += champ.games * weight;
        existing.signals.push(signal);
        return;
      }

      candidates.set(champ.championId, {
        ...champ,
        player,
        score: champ.games * weight,
        signals: [signal],
      });
    };

    for (const champ of player.clashHistory.topChampions.slice(0, 5)) add(champ, 16, 'aparece em Clash');
    for (const champ of player.flexQueue.topChampions.slice(0, 5)) add(champ, 12, 'aparece em Flex');
    for (const champ of player.soloQueue.topChampions.slice(0, 8)) add(champ, 9, 'pick recente');
    for (const champ of player.combinedTopChamps.slice(0, 10)) add(champ, 5, 'comfort combinado');

    for (const mastery of player.masteryTop10.slice(0, 5)) {
      const existing = candidates.get(mastery.championId);
      if (existing) {
        existing.score += Math.min(8, mastery.masteryLevel);
        existing.signals.push('maestria desempata');
      }
    }

    return [...candidates.values()].map((candidate) => {
      const winrateSignal = candidate.games >= 3 ? Math.max(0, candidate.winrate - 50) * 0.25 : 0;
      const kdaSignal = Math.min(10, candidate.kda * 1.5);
      const uniqueSignals = [...new Set(candidate.signals)];
      const reason = `${uniqueSignals.slice(0, 2).join(' + ')}; ${candidate.games} jogos, ${candidate.winrate}% WR`;
      return {
        ...candidate,
        score: candidate.score + winrateSignal + kdaSignal,
        reason,
      };
    }).sort((a, b) => b.score - a.score);
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
        gamePlan: {
          type: 'OBJECT',
          properties: {
            winCondition: { type: 'STRING' },
            earlyGame: { type: 'STRING' },
            teamfight: { type: 'STRING' },
            damageProfile: { type: 'STRING' },
            focusTarget: { type: 'STRING' },
            weakLink: { type: 'STRING' },
            threats: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  riotId: { type: 'STRING' },
                  position: { type: 'STRING' },
                  level: { type: 'INTEGER' },
                  reason: { type: 'STRING' },
                },
                required: ['riotId', 'position', 'level', 'reason'],
              },
            },
          },
          required: ['winCondition', 'earlyGame', 'teamfight', 'damageProfile', 'focusTarget', 'weakLink', 'threats'],
        },
      },
      required: ['bans', 'counterplays', 'predictedPicks', 'strategy', 'gamePlan'],
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

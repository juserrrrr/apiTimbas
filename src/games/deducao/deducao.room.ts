import { Client, CloseCode, Room } from 'colyseus';
import { randomUUID } from 'crypto';
import {
  FEATURE_DASHBOARD_GAMES,
  FEATURE_GAME_DEDUCAO,
} from '../../feature-flags/feature-flags.constants';
import { Role as UserRole } from '../../enums/role.enum';
import { gameDeps } from '../game-deps';
import { ChatMessage, CorpseState, DeducaoState, PlayerState } from './deducao.state';
import {
  MEETING_SEATS,
  OFFICE_MAP,
  GameMap,
  collidersFor,
  sightBlockersFor,
  stairProgressAt,
  taskSpotById,
  ventById,
} from './map';
import { distance, isWithin, moveTowards, PLAYER_RADIUS } from './movement';
import {
  DEFAULT_CONFIG,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MatchConfig,
  Role,
  assignRoles,
  canStartMatch,
  detectiveReading,
  maxKillersFor,
  sanitizeConfig,
  tallyVotes,
  winnerFor,
} from './rules';
import { AssignedTask, MIN_TASK_MS, TASK_RANGE, drawTasks } from './tasks';

const TICK_MS = 50;
const WALK_SPEED = 4.6;
const BLACKOUT_SPEED_BONUS = 1.15;
/// A rede engasga, o quadro atrasa e o passo seguinte vem maior do que devia.
/// Sem folga, quem joga de 4G ficaria preso na porta o tempo todo.
const SPEED_TOLERANCE = 1.35;
const REPORT_RANGE = 2.6;
const VENT_RANGE = 1.8;
const CHAT_LIMIT = 80;
const SABOTAGE_COOLDOWN_MS = 40_000;

const COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316',
  '#06b6d4', '#ec4899', '#84cc16', '#f5f5f5', '#78716c', '#14b8a6',
];

interface Seat {
  userId: number;
  discordId: string;
  role: Role;
  tasks: AssignedTask[];
  lastMoveAt: number;
  killReadyAt: number;
  sabotageReadyAt: number;
  activeTask: { spotId: string; startedAt: number } | null;
  vote: string | null;
  /// Leitura que o detetive pediu na reunião passada e recebe nesta.
  pendingReading: { targetId: string; targetName: string } | null;
  isAdmin: boolean;
}

export class DeducaoRoom extends Room<{ state: DeducaoState }> {
  maxClients = MAX_PLAYERS;

  private password = '';
  private seats = new Map<string, Seat>();
  private nextBlackoutAt = 0;
  private meetingDeadline = 0;
  private officeMap: GameMap = OFFICE_MAP;

  async onAuth(client: Client, options: { ticket?: string; password?: string }) {
    const { tickets, actor, access, featureFlags } = gameDeps();

    const discordId = tickets.consume(options?.ticket);
    if (!discordId) throw new Error('Sua entrada expirou. Volte para a lista de jogos e entre de novo.');
    const person = await actor.require(discordId);

    if (!(await access.has(person.id, ['dashboard.games'])))
      throw new Error('Seu acesso não inclui a área de jogos.');
    await featureFlags.ensureEnabledOrAdmin(FEATURE_DASHBOARD_GAMES, person.role);
    await featureFlags.ensureEnabledOrAdmin(FEATURE_GAME_DEDUCAO, person.role);

    if (this.password && options.password !== this.password)
      throw new Error('Senha da sala incorreta.');
    if ([...this.seats.values()].some((seat) => seat.userId === person.id))
      throw new Error('Você já está nesta sala em outra aba.');
    if (this.state.phase !== 'lobby') throw new Error('A partida já começou.');

    return person;
  }

  async onCreate(options: { name?: string; password?: string; hostName?: string }) {
    this.officeMap = await gameDeps().maps.current();
    this.setState(new DeducaoState());
    this.state.roomName = (options?.name ?? 'Sala do Timbas').slice(0, 32).trim() || 'Sala do Timbas';
    this.state.code = this.buildCode();
    this.password = (options?.password ?? '').slice(0, 24);
    this.state.private = Boolean(this.password);
    this.applyConfig(DEFAULT_CONFIG);

    this.onMessage('ready', (client) => this.onReady(client));
    this.onMessage('config', (client, payload) => this.onConfig(client, payload));
    this.onMessage('start', (client) => this.onStart(client));
    this.onMessage('move', (client, payload) => this.onMove(client, payload));
    this.onMessage('task:begin', (client, payload) => this.onTaskBegin(client, payload));
    this.onMessage('task:done', (client, payload) => this.onTaskDone(client, payload));
    this.onMessage('kill', (client, payload) => this.onKill(client, payload));
    this.onMessage('vent', (client, payload) => this.onVent(client, payload));
    this.onMessage('sabotage', (client) => this.onSabotage(client));
    this.onMessage('report', (client, payload) => this.onReport(client, payload));
    this.onMessage('emergency', (client) => this.onEmergency(client));
    this.onMessage('inspect', (client, payload) => this.onInspect(client, payload));
    this.onMessage('vote', (client, payload) => this.onVote(client, payload));
    this.onMessage('chat', (client, payload) => this.onChat(client, payload));
    this.onMessage('restart', (client) => this.onRestart(client));

    this.setSimulationInterval(() => this.tick(), TICK_MS);
    void this.publishMetadata();
  }

  async onJoin(
    client: Client,
    _options: unknown,
    person: { id: number; discordId: string; name: string; avatar: string | null; role: string },
  ) {
    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = person.name;
    player.avatar = person.avatar ?? '';
    player.color = this.freeColor();
    player.emergenciesLeft = this.state.config.emergencyPerPlayer;
    const spawn = this.officeMap.spawns[this.state.players.size % this.officeMap.spawns.length];
    player.x = spawn.x;
    player.z = spawn.z;
    player.level = spawn.level ?? 0;
    this.state.players.set(client.sessionId, player);

    this.seats.set(client.sessionId, {
      userId: person.id,
      discordId: person.discordId,
      role: 'funcionario',
      tasks: [],
      lastMoveAt: Date.now(),
      killReadyAt: 0,
      sabotageReadyAt: 0,
      activeTask: null,
      vote: null,
      pendingReading: null,
      isAdmin: person.role === UserRole.ADMIN,
    });

    if (!this.state.hostId) {
      this.state.hostId = client.sessionId;
      this.state.hostCanStartSolo = person.role === UserRole.ADMIN;
    }
    this.system(`${person.name} entrou na sala.`);
    await this.publishMetadata();
  }

  async onLeave(client: Client, code?: number) {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;

    // Saída pela porta é a pessoa clicando em sair. Qualquer outro código é
    // queda de conexão, e aí vale esperar ela voltar.
    const consented = code === CloseCode.CONSENTED;
    if (!consented && this.state.phase !== 'lobby') {
      try {
        await this.allowReconnection(client, 40);
        const back = this.state.players.get(client.sessionId);
        if (back) back.connected = true;
        return;
      } catch {
        // Não voltou a tempo, segue o baque abaixo.
      }
    }

    if (player) this.system(`${player.name} saiu.`);
    this.state.players.delete(client.sessionId);
    this.seats.delete(client.sessionId);

    if (this.state.hostId === client.sessionId) {
      this.state.hostId = [...this.state.players.keys()][0] ?? '';
      this.state.hostCanStartSolo = this.seats.get(this.state.hostId)?.isAdmin ?? false;
    }
    if (this.state.phase !== 'lobby' && this.state.phase !== 'fim') this.checkEnd();
    await this.publishMetadata();
  }

  // ── Lobby ────────────────────────────────────────────────────────────────

  private onReady(client: Client) {
    if (this.state.phase !== 'lobby') return;
    const player = this.state.players.get(client.sessionId);
    if (player) player.ready = !player.ready;
  }

  private onConfig(client: Client, payload: Partial<MatchConfig>) {
    if (this.state.phase !== 'lobby' || client.sessionId !== this.state.hostId) return;
    this.applyConfig({ ...this.currentConfig(), ...payload });
  }

  private onStart(client: Client) {
    if (this.state.phase !== 'lobby' || client.sessionId !== this.state.hostId) return;
    const ids = [...this.state.players.keys()];
    const isAdmin = this.seats.get(client.sessionId)?.isAdmin ?? false;
    if (!canStartMatch(ids.length, isAdmin)) {
      client.send('erro', `A partida precisa de pelo menos ${MIN_PLAYERS} jogadores.`);
      return;
    }
    if (ids.some((id) => !this.state.players.get(id)!.ready && id !== this.state.hostId)) {
      client.send('erro', 'Ainda tem gente que não marcou pronto.');
      return;
    }
    this.beginMatch(ids);
  }

  private beginMatch(ids: string[]) {
    const config = sanitizeConfig(this.currentConfig(), ids.length);
    this.applyConfig(config);

    const roles = assignRoles(ids, config);
    const tasks = drawTasks(ids, this.officeMap.taskSpots, config.tasksPerPlayer);
    const killers = ids.filter((id) => roles.get(id) === 'assassino');

    let crewTasks = 0;
    for (const id of ids) {
      const seat = this.seats.get(id)!;
      const player = this.state.players.get(id)!;
      seat.role = roles.get(id)!;
      seat.tasks = tasks.get(id)!;
      seat.killReadyAt = Date.now() + config.killCooldownMs;
      seat.sabotageReadyAt = Date.now() + SABOTAGE_COOLDOWN_MS;
      seat.activeTask = null;
      seat.vote = null;
      seat.pendingReading = null;

      player.alive = true;
      player.ready = false;
      player.inVent = false;
      player.tasksDone = 0;
      player.tasksTotal = seat.tasks.length;
      player.emergenciesLeft = config.emergencyPerPlayer;
      if (seat.role !== 'assassino') crewTasks += seat.tasks.length;
    }

    this.state.corpses.clear();
    this.state.chat.clear();
    this.state.tasksDone = 0;
    this.state.tasksTotal = crewTasks;
    this.state.winner = '';
    this.state.endReason = '';
    this.state.blackout = false;
    this.state.phase = 'jogando';
    this.state.startedAt = Date.now();
    this.nextBlackoutAt = Date.now() + config.blackoutEverySeconds * 1000;
    this.teleportToSpawns();

    for (const id of ids) {
      const seat = this.seats.get(id)!;
      const client = this.clients.find((candidate) => candidate.sessionId === id);
      client?.send('papel', {
        role: seat.role,
        tasks: seat.tasks.map((task) => task.spotId),
        allies: seat.role === 'assassino' ? killers.filter((killer) => killer !== id) : [],
      });
    }
    void this.publishMetadata();
  }

  private onRestart(client: Client) {
    if (this.state.phase !== 'fim' || client.sessionId !== this.state.hostId) return;
    this.state.phase = 'lobby';
    this.state.winner = '';
    this.state.endReason = '';
    this.state.corpses.clear();
    this.state.chat.clear();
    this.closeMeeting();
    for (const player of this.state.players.values()) {
      player.alive = true;
      player.ready = false;
      player.inVent = false;
      player.tasksDone = 0;
      player.tasksTotal = 0;
    }
    this.teleportToSpawns();
    void this.publishMetadata();
  }

  // ── Movimento e ações ────────────────────────────────────────────────────

  private onMove(client: Client, payload: { x: number; z: number; dir: number; moving: boolean }) {
    const player = this.state.players.get(client.sessionId);
    const seat = this.seats.get(client.sessionId);
    if (!player || !seat || !this.isPlayable()) return;
    if (typeof payload?.x !== 'number' || typeof payload?.z !== 'number') return;

    const now = Date.now();
    const elapsed = Math.min(Math.max(now - seat.lastMoveAt, 0), 400) / 1000;
    seat.lastMoveAt = now;

    const blackoutBonus = this.state.blackout && seat.role === 'assassino' ? BLACKOUT_SPEED_BONUS : 1;
    const budget = WALK_SPEED * blackoutBonus * SPEED_TOLERANCE * elapsed + 0.05;
    const target = { x: payload.x, z: payload.z };

    // Fantasma atravessa parede, e quem está no duto se desloca por dentro dele:
    // nos dois casos a colisão do escritório não vale.
    const next =
      player.alive && !player.inVent
        ? moveTowards({ x: player.x, z: player.z }, target, budget, collidersFor(player.level, this.officeMap))
        : this.clampToBounds(target, { x: player.x, z: player.z }, budget);

    player.x = next.x;
    player.z = next.z;
    player.dir = Number.isFinite(payload.dir) ? payload.dir : player.dir;
    player.moving = Boolean(payload.moving);

    if (player.alive && !player.inVent) {
      const crossing = stairProgressAt(player.x, player.z, this.officeMap);
      const previousLevel = player.level;

      // A altura muda continuamente no navegador conforme x/z. O servidor só
      // troca a camada de colisão depois do meio da escada, sem mover o jogador.
      if (
        crossing &&
        player.level === crossing.stair.level &&
        crossing.progress >= 0.52
      ) {
        player.level = crossing.stair.targetLevel;
      } else if (
        crossing &&
        player.level === crossing.stair.targetLevel &&
        crossing.progress <= 0.48
      ) {
        player.level = crossing.stair.level;
      }

      if (player.level !== previousLevel) {
        seat.activeTask = null;
        client.send('andar', { level: player.level });
      }
    }
  }

  private onTaskBegin(client: Client, payload: { spotId?: string }) {
    const seat = this.seats.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!seat || !player || this.state.phase !== 'jogando') return;

    const assigned = seat.tasks.find((task) => task.spotId === payload?.spotId && !task.done);
    const spot = assigned && taskSpotById(assigned.spotId, this.officeMap);
    if (!spot) return;
    if ((spot.level ?? 0) !== player.level || distance(player, spot) > TASK_RANGE) return;

    seat.activeTask = { spotId: spot.id, startedAt: Date.now() };
    client.send('task:ok', { spotId: spot.id, kind: spot.kind, label: spot.label });
  }

  private onTaskDone(client: Client, payload: { spotId?: string }) {
    const seat = this.seats.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!seat || !player || this.state.phase !== 'jogando') return;

    const active = seat.activeTask;
    if (!active || active.spotId !== payload?.spotId) return;
    if (Date.now() - active.startedAt < MIN_TASK_MS) return;

    const spot = taskSpotById(active.spotId, this.officeMap);
    // Fantasma termina a tarefa de onde estiver: ele não anda mais pelo mapa
    // para provar que chegou lá.
    if (!spot || (player.alive && ((spot.level ?? 0) !== player.level || distance(player, spot) > TASK_RANGE))) return;

    const assigned = seat.tasks.find((task) => task.spotId === active.spotId);
    if (!assigned || assigned.done) return;

    assigned.done = true;
    seat.activeTask = null;
    player.tasksDone += 1;
    // A tarefa do assassino é de mentira: serve para ele fingir que trabalha,
    // não para ganhar o jogo do outro time.
    if (seat.role !== 'assassino') {
      this.state.tasksDone += 1;
      this.checkEnd();
    }
  }

  private onKill(client: Client, payload: { targetId?: string }) {
    const seat = this.seats.get(client.sessionId);
    const killer = this.state.players.get(client.sessionId);
    if (!seat || !killer || seat.role !== 'assassino' || !killer.alive) return;
    if (this.state.phase !== 'jogando' || Date.now() < seat.killReadyAt) return;

    const victim = this.state.players.get(payload?.targetId ?? '');
    const victimSeat = this.seats.get(payload?.targetId ?? '');
    if (!victim || !victimSeat || !victim.alive || victimSeat.role === 'assassino') return;
    if (victim.level !== killer.level) return;
    if (!isWithin(killer, victim, this.state.config.killRange, sightBlockersFor(killer.level, this.officeMap))) return;

    victim.alive = false;
    victim.moving = false;
    victim.inVent = false;
    victimSeat.activeTask = null;

    const corpse = new CorpseState();
    corpse.id = randomUUID();
    corpse.playerId = victim.id;
    corpse.name = victim.name;
    corpse.color = victim.color;
    corpse.x = victim.x;
    corpse.z = victim.z;
    corpse.level = victim.level;
    this.state.corpses.push(corpse);

    killer.x = victim.x;
    killer.z = victim.z;
    killer.level = victim.level;
    seat.killReadyAt = Date.now() + this.state.config.killCooldownMs;

    this.clients
      .find((candidate) => candidate.sessionId === victim.id)
      ?.send('morte', { by: killer.name });
    this.checkEnd();
  }

  private onVent(client: Client, payload: { ventId?: string }) {
    const seat = this.seats.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!seat || !player || seat.role !== 'assassino' || !player.alive) return;
    if (this.state.phase !== 'jogando') return;

    if (!payload?.ventId) {
      if (!player.inVent) return;
      player.inVent = false;
      return;
    }

    const vent = ventById(payload.ventId, this.officeMap);
    if (!vent) return;
    if (player.inVent) {
      const current = this.officeMap.vents.find(
        (candidate) => (candidate.level ?? 0) === player.level && distance(player, candidate) < 0.6,
      );
      if (!current || !current.links.includes(vent.id)) return;
    } else if ((vent.level ?? 0) !== player.level || distance(player, vent) > VENT_RANGE) {
      return;
    }

    player.x = vent.x;
    player.z = vent.z;
    player.level = vent.level ?? 0;
    player.inVent = true;
  }

  private onSabotage(client: Client) {
    const seat = this.seats.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!seat || !player || seat.role !== 'assassino' || !player.alive) return;
    if (this.state.phase !== 'jogando' || Date.now() < seat.sabotageReadyAt) return;

    seat.sabotageReadyAt = Date.now() + SABOTAGE_COOLDOWN_MS;
    this.startBlackout();
  }

  private onReport(client: Client, payload: { corpseId?: string }) {
    const player = this.state.players.get(client.sessionId);
    if (!player?.alive || this.state.phase !== 'jogando') return;

    const corpse = this.state.corpses.find((candidate) => candidate.id === payload?.corpseId);
    if (!corpse || corpse.reported || corpse.level !== player.level) return;
    if (distance(player, corpse) > REPORT_RANGE) return;

    corpse.reported = true;
    this.openMeeting('corpo', player, corpse.name);
  }

  private onEmergency(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player?.alive || this.state.phase !== 'jogando') return;
    if (player.emergenciesLeft <= 0) return;
    if ((this.officeMap.emergency.level ?? 0) !== player.level || distance(player, this.officeMap.emergency) > REPORT_RANGE) return;

    player.emergenciesLeft -= 1;
    this.openMeeting('emergencia', player, '');
  }

  /// O detetive escolhe alguém durante a reunião e a leitura chega só na
  /// próxima. Resposta na hora encerraria a discussão antes dela começar.
  private onInspect(client: Client, payload: { targetId?: string }) {
    const seat = this.seats.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!seat || !player?.alive || seat.role !== 'detetive') return;
    if (this.state.phase !== 'reuniao' || seat.pendingReading) return;

    const target = this.state.players.get(payload?.targetId ?? '');
    if (!target || !target.alive || target.id === player.id) return;

    seat.pendingReading = { targetId: target.id, targetName: target.name };
    client.send('investigacao', { status: 'anotado', name: target.name });
  }

  private onVote(client: Client, payload: { targetId?: string }) {
    const seat = this.seats.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!seat || !player?.alive || this.state.phase !== 'votacao' || seat.vote !== null) return;

    const targetId = payload?.targetId ?? '';
    if (targetId && !this.state.players.get(targetId)?.alive) return;

    seat.vote = targetId;
    this.state.meeting.voted.set(client.sessionId, true);

    const pending = [...this.state.players.values()].filter(
      (candidate) => candidate.alive && this.seats.get(candidate.id)?.vote === null,
    );
    if (pending.length === 0) this.closeVoting();
  }

  private onChat(client: Client, payload: { text?: string }) {
    const player = this.state.players.get(client.sessionId);
    const text = (payload?.text ?? '').trim().slice(0, 200);
    if (!player || !text) return;

    const talkingPhase = this.state.phase === 'lobby' || this.state.phase === 'reuniao' || this.state.phase === 'votacao' || this.state.phase === 'fim';
    if (!talkingPhase && player.alive) return;

    // Morto conversa com morto. Se a fala dele entrasse no estado da sala, quem
    // está vivo leria o nome do assassino em dois minutos de jogo.
    if (!player.alive && this.state.phase !== 'fim') {
      const ghosts = this.clients.filter((candidate) => !this.state.players.get(candidate.sessionId)?.alive);
      for (const ghost of ghosts) {
        ghost.send('chat:fantasma', { name: player.name, color: player.color, text, at: Date.now() });
      }
      return;
    }

    this.pushChat({ from: player.id, name: player.name, color: player.color, text, system: false });
  }

  // ── Reunião ──────────────────────────────────────────────────────────────

  private openMeeting(reason: 'corpo' | 'emergencia', by: PlayerState, victimName: string) {
    this.state.phase = 'reuniao';
    this.state.blackout = false;
    this.state.chat.clear();
    this.state.corpses.clear();

    const meeting = this.state.meeting;
    meeting.open = true;
    meeting.reason = reason;
    meeting.calledBy = by.id;
    meeting.calledByName = by.name;
    meeting.victimName = victimName;
    meeting.voting = false;
    meeting.voted.clear();
    meeting.tally.clear();
    meeting.skips = 0;
    meeting.ejectedId = '';
    meeting.ejectedName = '';
    meeting.ejectedRole = '';
    meeting.tie = false;
    meeting.endsAt = Date.now() + this.state.config.meetingSeconds * 1000;
    this.meetingDeadline = meeting.endsAt;

    for (const seat of this.seats.values()) {
      seat.vote = null;
      seat.activeTask = null;
    }
    for (const player of this.state.players.values()) {
      player.inVent = false;
      player.moving = false;
    }
    this.teleportToMeetingSeats();
    this.deliverReadings();

    this.system(
      reason === 'corpo'
        ? `${by.name} encontrou o corpo de ${victimName}.`
        : `${by.name} chamou uma reunião de emergência.`,
    );
  }

  private deliverReadings() {
    for (const [sessionId, seat] of this.seats) {
      if (!seat.pendingReading) continue;
      const targetSeat = this.seats.get(seat.pendingReading.targetId);
      const target = this.state.players.get(seat.pendingReading.targetId);
      const client = this.clients.find((candidate) => candidate.sessionId === sessionId);
      if (targetSeat && target) {
        client?.send('investigacao', {
          status: detectiveReading({ id: target.id, role: targetSeat.role, alive: target.alive }),
          name: seat.pendingReading.targetName,
        });
      }
      seat.pendingReading = null;
    }
  }

  private startVoting() {
    this.state.phase = 'votacao';
    this.state.meeting.voting = true;
    this.state.meeting.endsAt = Date.now() + this.state.config.voteSeconds * 1000;
    this.meetingDeadline = this.state.meeting.endsAt;
  }

  private closeVoting() {
    const votes = new Map<string, string | null>();
    for (const [sessionId, seat] of this.seats) {
      if (!this.state.players.get(sessionId)?.alive) continue;
      votes.set(sessionId, seat.vote || null);
    }

    const result = tallyVotes(votes);
    const meeting = this.state.meeting;
    meeting.voting = false;
    meeting.tie = result.tie;
    meeting.skips = [...votes.values()].filter((vote) => !vote).length;
    for (const [targetId, count] of Object.entries(result.counts)) meeting.tally.set(targetId, count);

    if (result.ejected) {
      const ejected = this.state.players.get(result.ejected);
      const ejectedSeat = this.seats.get(result.ejected);
      if (ejected && ejectedSeat) {
        ejected.alive = false;
        ejected.moving = false;
        ejected.inVent = false;
        meeting.ejectedId = ejected.id;
        meeting.ejectedName = ejected.name;
        meeting.ejectedRole = this.state.config.revealRoleOnEject ? ejectedSeat.role : '';
      }
    }

    // A tela da ejeção precisa de tempo na frente de todo mundo antes do mapa
    // voltar, então o fim da reunião fica agendado em vez de imediato.
    this.meetingDeadline = Date.now() + 6_000;
  }

  private closeMeeting() {
    const meeting = this.state.meeting;
    meeting.open = false;
    meeting.voting = false;
    meeting.reason = '';
    meeting.voted.clear();
    meeting.tally.clear();
    meeting.endsAt = 0;
    this.meetingDeadline = 0;
    for (const seat of this.seats.values()) {
      seat.vote = null;
      seat.killReadyAt = Math.max(seat.killReadyAt, Date.now() + this.state.config.killCooldownMs);
    }
  }

  // ── Loop ─────────────────────────────────────────────────────────────────

  private tick() {
    const now = Date.now();

    if (this.state.phase === 'reuniao' && now >= this.meetingDeadline) {
      this.startVoting();
      return;
    }
    if (this.state.phase === 'votacao') {
      if (this.state.meeting.voting && now >= this.meetingDeadline) this.closeVoting();
      else if (!this.state.meeting.voting && now >= this.meetingDeadline) {
        this.closeMeeting();
        if (!this.checkEnd()) {
          this.teleportToSpawns();
          this.state.phase = 'jogando';
          this.nextBlackoutAt = now + this.state.config.blackoutEverySeconds * 1000;
        }
      }
      return;
    }
    if (this.state.phase !== 'jogando') return;

    if (this.state.blackout && now >= this.state.blackoutEndsAt) {
      this.state.blackout = false;
      this.nextBlackoutAt = now + this.state.config.blackoutEverySeconds * 1000;
    } else if (!this.state.blackout && this.nextBlackoutAt > 0 && now >= this.nextBlackoutAt) {
      this.startBlackout();
    }
  }

  /// A luz cai, a visão de todo mundo encolhe e o assassino anda mais rápido. É
  /// a janela de tensão do round, herdada do Deceit.
  private startBlackout() {
    if (this.state.phase !== 'jogando' || this.state.blackout) return;
    this.state.blackout = true;
    this.state.blackoutEndsAt = Date.now() + this.state.config.blackoutSeconds * 1000;
    this.nextBlackoutAt = 0;
    this.broadcast('apagao', { until: this.state.blackoutEndsAt });
  }

  private checkEnd(): boolean {
    const players = [...this.state.players.values()].map((player) => ({
      id: player.id,
      role: this.seats.get(player.id)?.role ?? 'funcionario',
      alive: player.alive,
    }));
    const winner = winnerFor(players, this.state.tasksDone, this.state.tasksTotal);
    if (!winner) return false;

    this.state.phase = 'fim';
    this.state.winner = winner;
    this.state.endReason =
      winner === 'escritorio'
        ? this.state.tasksDone >= this.state.tasksTotal
          ? 'Todas as tarefas foram concluídas.'
          : 'Todos os assassinos foram expulsos.'
        : 'Os assassinos ficaram em maioria.';
    this.state.blackout = false;
    this.closeMeeting();

    this.broadcast('fim', {
      winner,
      roles: [...this.seats.entries()].map(([sessionId, seat]) => ({ id: sessionId, role: seat.role })),
    });
    void this.publishMetadata();
    return true;
  }

  // ── Apoio ────────────────────────────────────────────────────────────────

  private isPlayable(): boolean {
    return this.state.phase === 'jogando' || this.state.phase === 'lobby';
  }

  private clampToBounds(target: { x: number; z: number }, from: { x: number; z: number }, budget: number) {
    const stepped = moveTowards(from, target, budget, [], PLAYER_RADIUS);
    const { x, z, w, d } = this.officeMap.bounds;
    return {
      x: Math.min(Math.max(stepped.x, x + PLAYER_RADIUS), x + w - PLAYER_RADIUS),
      z: Math.min(Math.max(stepped.z, z + PLAYER_RADIUS), z + d - PLAYER_RADIUS),
    };
  }

  private teleportToSpawns() {
    let index = 0;
    for (const player of this.state.players.values()) {
      const spawn = this.officeMap.spawns[index % this.officeMap.spawns.length];
      player.x = spawn.x;
      player.z = spawn.z;
      player.level = spawn.level ?? 0;
      player.moving = false;
      index += 1;
    }
  }

  private teleportToMeetingSeats() {
    let index = 0;
    for (const player of this.state.players.values()) {
      const seats = this.officeMap.meetingSeats.length > 0 ? this.officeMap.meetingSeats : MEETING_SEATS;
      const seat = seats[index % seats.length];
      player.x = seat.x;
      player.z = seat.z;
      player.level = seat.level;
      player.dir = seat.dir;
      player.moving = false;
      index += 1;
    }
  }

  private currentConfig(): MatchConfig {
    const config = this.state.config;
    return {
      killers: config.killers,
      withDetective: config.withDetective,
      tasksPerPlayer: config.tasksPerPlayer,
      killCooldownMs: config.killCooldownMs,
      killRange: config.killRange,
      visionRange: config.visionRange,
      meetingSeconds: config.meetingSeconds,
      voteSeconds: config.voteSeconds,
      revealRoleOnEject: config.revealRoleOnEject,
      emergencyPerPlayer: config.emergencyPerPlayer,
      blackoutEverySeconds: config.blackoutEverySeconds,
      blackoutSeconds: config.blackoutSeconds,
    };
  }

  private applyConfig(next: MatchConfig) {
    const clean = sanitizeConfig(next, Math.max(this.state.players.size, MIN_PLAYERS));
    Object.assign(this.state.config, clean);
  }

  private freeColor(): string {
    const taken = new Set([...this.state.players.values()].map((player) => player.color));
    return COLORS.find((color) => !taken.has(color)) ?? COLORS[0];
  }

  private buildCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  }

  private system(text: string) {
    this.pushChat({ from: '', name: 'Sistema', color: '#94a3b8', text, system: true });
  }

  private pushChat(input: { from: string; name: string; color: string; text: string; system: boolean }) {
    const message = new ChatMessage();
    message.id = randomUUID();
    message.from = input.from;
    message.name = input.name;
    message.color = input.color;
    message.text = input.text;
    message.system = input.system;
    message.at = Date.now();
    this.state.chat.push(message);
    while (this.state.chat.length > CHAT_LIMIT) this.state.chat.shift();
  }

  /// O que a lista de salas do hub mostra sem precisar entrar em nenhuma.
  private publishMetadata() {
    return this.setMetadata({
      name: this.state.roomName,
      code: this.state.code,
      private: this.state.private,
      phase: this.state.phase,
      players: this.state.players.size,
      maxPlayers: MAX_PLAYERS,
      maxKillers: maxKillersFor(Math.max(this.state.players.size, MIN_PLAYERS)),
      host: this.state.players.get(this.state.hostId)?.name ?? '',
    });
  }
}

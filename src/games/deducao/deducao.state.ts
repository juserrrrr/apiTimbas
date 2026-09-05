import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema';

/// O estado que o Colyseus replica para a sala inteira.
///
/// O papel de cada um fica de fora de propósito: quem é assassino sai por
/// mensagem direta para o próprio dono do papel, senão bastaria abrir o
/// inspetor do navegador para ganhar o jogo. A posição é pública para manter
/// todos os jogadores visíveis até no apagão; nome e cor são ocultados pela
/// tela. Jogadas que contam são conferidas novamente pelo servidor.

export class PlayerState extends Schema {
  @type('string') id = '';
  @type('string') name = '';
  @type('string') avatar = '';
  @type('string') color = '#ffffff';
  @type('number') x = 0;
  @type('number') z = 0;
  @type('number') level = 0;
  @type('number') elevation = 0;
  @type('number') dir = 0;
  @type('boolean') moving = false;
  @type('number') moveSequence = 0;
  @type('boolean') crouching = false;
  @type('boolean') airborne = false;
  @type('boolean') alive = true;
  @type('boolean') connected = true;
  @type('boolean') ready = false;
  @type('boolean') microphoneReady = false;
  @type('boolean') inVent = false;
  @type('number') tasksDone = 0;
  @type('number') tasksTotal = 0;
  @type('number') emergenciesLeft = 0;
}

export class CorpseState extends Schema {
  @type('string') id = '';
  @type('string') playerId = '';
  @type('string') name = '';
  @type('string') color = '#ffffff';
  @type('number') x = 0;
  @type('number') z = 0;
  @type('number') level = 0;
  @type('boolean') reported = false;
}

export class ChatMessage extends Schema {
  @type('string') id = '';
  @type('string') from = '';
  @type('string') name = '';
  @type('string') color = '#ffffff';
  @type('string') text = '';
  @type('number') at = 0;
  @type('boolean') system = false;
}

export class MeetingState extends Schema {
  @type('boolean') open = false;
  /// 'corpo' quando alguém reportou, 'emergencia' quando apertaram o botão.
  @type('string') reason = '';
  @type('string') calledBy = '';
  @type('string') calledByName = '';
  @type('string') victimName = '';
  @type('boolean') voting = false;
  @type('number') endsAt = 0;
  /// Quem já votou, sem dizer em quem. Voto aberto na hora tira a graça: todo
  /// mundo espera o primeiro e copia. A conta completa aparece na apuração.
  @type({ map: 'boolean' }) voted = new MapSchema<boolean>();
  @type({ map: 'number' }) tally = new MapSchema<number>();
  @type('number') skips = 0;
  @type('string') ejectedId = '';
  @type('string') ejectedName = '';
  @type('string') ejectedRole = '';
  @type('boolean') tie = false;
}

export class ConfigState extends Schema {
  @type('number') killers = 1;
  @type('boolean') withDetective = true;
  @type('number') tasksPerPlayer = 4;
  @type('number') killCooldownMs = 25_000;
  @type('number') killRange = 2.2;
  @type('number') visionRange = 11;
  @type('number') meetingSeconds = 45;
  @type('number') voteSeconds = 30;
  @type('boolean') revealRoleOnEject = true;
  @type('number') emergencyPerPlayer = 1;
  @type('number') emergencyCooldownMs = 30_000;
  @type('number') blackoutSeconds = 25;
}

export class DeducaoState extends Schema {
  @type('string') roomName = '';
  @type('string') mapId = 'original';
  @type('string') mapName = '';
  @type('string') code = '';
  @type('boolean') private = false;
  @type('string') hostId = '';
  @type('boolean') hostCanStartSolo = false;
  /// lobby, jogando, reuniao, votacao ou fim.
  @type('string') phase = 'lobby';
  @type('number') startedAt = 0;
  @type('number') tasksDone = 0;
  @type('number') tasksTotal = 0;
  @type('boolean') blackout = false;
  @type('number') blackoutEndsAt = 0;
  @type('number') emergencyReadyAt = 0;
  @type('string') winner = '';
  @type('string') endReason = '';
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type([CorpseState]) corpses = new ArraySchema<CorpseState>();
  @type([ChatMessage]) chat = new ArraySchema<ChatMessage>();
  @type(MeetingState) meeting = new MeetingState();
  @type(ConfigState) config = new ConfigState();
}

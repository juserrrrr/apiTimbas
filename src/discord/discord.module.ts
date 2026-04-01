import { Module } from '@nestjs/common';
import { NecordModule } from 'necord';
import { IntentsBitField } from 'discord.js';

// Services
import { MatchStateService } from './services/match-state.service';
import { EventStateService } from './services/event-state.service';
import { ChannelManagerService } from './services/channel-manager.service';

// Commands
import { AnunciarCommand } from './commands/anunciar.command';
import { ApagarCommand } from './commands/apagar.command';
import { RankingCommand } from './commands/ranking.command';
import { SetAvatarCommand } from './commands/setavatar.command';
import { TrazertodosCommand } from './commands/trazertodos.command';
import { VersusCommand } from './commands/versus.command';
import { UsuarioLolCommand } from './commands/usuariolol.command';
import { CriarPersonalizadaCommand } from './commands/criar-personalizada.command';
import { EventoCommand } from './commands/evento.command';

// Events
import { ReadyEvent } from './events/ready.event';
import { MemberEvent } from './events/member.event';

// Interactions
import { OfflineMatchInteraction } from './interactions/offline-match.interaction';
import { OfflineMatchSelectInteraction } from './interactions/offline-match-select.interaction';
import { OnlineLobbyInteraction } from './interactions/online-lobby.interaction';
import { EventInteraction } from './interactions/event.interaction';
import { LolVerificationInteraction } from './interactions/lol-verification.interaction';

// NestJS module imports
import { LeagueMatchModule } from '../customLeagueMath/leagueMatch.module';
import { UserModule } from '../user/user.module';
import { RiotModule } from '../riot/riot.module';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';

@Module({
  imports: [
    NecordModule.forRoot({
      token: process.env.TOKEN_BOT ?? '',
      intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.GuildVoiceStates,
        IntentsBitField.Flags.GuildBans,
        IntentsBitField.Flags.MessageContent,
      ],
    }),
    LeagueMatchModule,
    UserModule,
    RiotModule,
    LeaderboardModule,
  ],
  providers: [
    // Services
    MatchStateService,
    EventStateService,
    ChannelManagerService,
    // Commands
    AnunciarCommand,
    ApagarCommand,
    RankingCommand,
    SetAvatarCommand,
    TrazertodosCommand,
    VersusCommand,
    UsuarioLolCommand,
    CriarPersonalizadaCommand,
    EventoCommand,
    // Events
    ReadyEvent,
    MemberEvent,
    // Interactions
    OfflineMatchInteraction,
    OfflineMatchSelectInteraction,
    OnlineLobbyInteraction,
    EventInteraction,
    LolVerificationInteraction,
  ],
})
export class DiscordBotModule {}

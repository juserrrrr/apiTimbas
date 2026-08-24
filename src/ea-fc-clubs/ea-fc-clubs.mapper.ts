import {
  EaClub,
  EaClubMatch,
  EaClubMatchPlayer,
  EaClubMember,
  EaClubMemberStats,
  EaClubOverallStats,
  EaExternalRecord,
  EaFcPayloadError,
} from './ea-fc-clubs.types';
import { isRecord } from './ea-fc-clubs.schemas';

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return repairMojibake(value.trim());
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function repairMojibake(value: string): string {
  if (!/[ÃÂ][\u0080-\u00bf]|â[\u0080-\u00bf]/.test(value)) return value;
  const repaired = Buffer.from(value, 'latin1').toString('utf8');
  return repaired.includes('\uFFFD') ? value : repaired;
}

function asNumber(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asInteger(value: unknown): number | undefined {
  const parsed = asNumber(value);
  return parsed === undefined ? undefined : Math.trunc(parsed);
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === '1' || value === 1 || value === 'true') return true;
  if (value === '0' || value === 0 || value === 'false') return false;
  return undefined;
}

export function mapEaClub(
  payload: EaExternalRecord,
  clubId: string,
  platform: string,
): EaClub {
  const direct = payload[clubId];
  const club = isRecord(direct)
    ? direct
    : Object.values(payload).find(
        (value) => isRecord(value) && asString(value.clubId) === String(clubId),
      );
  if (!isRecord(club)) {
    throw new EaFcPayloadError('Requested club is absent from EA response');
  }
  const details = isRecord(club.details) ? club.details : undefined;
  const name =
    asString(club.name) ??
    asString(club.clubName) ??
    (details ? asString(details.name) : undefined);
  const externalId =
    asString(club.clubId) ??
    (details ? asString(details.clubId) : undefined) ??
    clubId;
  if (!name) throw new EaFcPayloadError('EA club name is missing');
  return { externalId, name, platform };
}

export function mapEaClubSearchResult(
  value: EaExternalRecord,
  platform: string,
): EaClub {
  const clubInfo = isRecord(value.clubInfo) ? value.clubInfo : undefined;
  const nested =
    clubInfo && !asString(clubInfo.clubId)
      ? Object.values(clubInfo).find(isRecord)
      : clubInfo;
  const club = nested ?? value;
  const externalId = asString(club.clubId) ?? asString(value.clubId);
  const name =
    asString(club.name) ?? asString(value.clubName) ?? asString(value.name);
  if (!externalId || !name) {
    throw new EaFcPayloadError('EA club search result is missing identity');
  }
  return { externalId, name, platform };
}

function clubName(club: EaExternalRecord): string | undefined {
  const details = isRecord(club.details) ? club.details : undefined;
  return (
    asString(club.name) ??
    asString(club.clubName) ??
    (details ? asString(details.name) : undefined)
  );
}

function mapPlayer(
  externalPlayerId: string,
  value: EaExternalRecord,
): EaClubMatchPlayer {
  const playerName = asString(value.playername) ?? asString(value.name);
  if (!playerName)
    throw new EaFcPayloadError('EA match player name is missing');
  const id = externalPlayerId.trim();
  return {
    externalPlayerId: id && id !== '0' ? id : undefined,
    playerName,
    position: asString(value.pos),
    rating: asNumber(value.rating),
    goals: asInteger(value.goals) ?? 0,
    assists: asInteger(value.assists) ?? 0,
    shots: asInteger(value.shots),
    passesAttempted: asInteger(value.passattempts),
    passesCompleted: asInteger(value.passesmade),
    tacklesAttempted: asInteger(value.tackleattempts),
    tacklesCompleted: asInteger(value.tacklesmade),
    saves: asInteger(value.saves),
    yellowCards: asInteger(value.yellowcards ?? value.yellowCards ?? value.yellow_cards),
    redCards: asInteger(value.redcards ?? value.redCards ?? value.red_cards),
    manOfTheMatch: asBoolean(value.man_of_the_match ?? value.mom),
  };
}

export function mapEaMatch(payload: EaExternalRecord): EaClubMatch {
  const clubs = payload.clubs;
  const players = payload.players;
  if (!isRecord(clubs) || !isRecord(players)) {
    throw new EaFcPayloadError('EA match clubs or players are missing');
  }
  const clubEntries = Object.entries(clubs).filter((entry) =>
    isRecord(entry[1]),
  );
  if (clubEntries.length !== 2) {
    throw new EaFcPayloadError('EA match must contain exactly two clubs');
  }
  const mappedClubs = clubEntries
    .map(([key, value], index) => {
      const club = value as EaExternalRecord;
      const details = isRecord(club.details) ? club.details : undefined;
      const id = asString(details?.clubId) ?? asString(club.clubId) ?? key;
      const name = clubName(club);
      const score = asInteger(club.goals ?? club.score);
      if (!name || score === undefined) {
        throw new EaFcPayloadError(
          'EA match club identity or score is missing',
        );
      }
      const side = asString(club.teamSide ?? club.TEAM ?? club.side);
      const order =
        side === 'home' || side === '0'
          ? 0
          : side === 'away' || side === '1'
            ? 1
            : index;
      return { key, id, name, score, order };
    })
    .sort((a, b) => a.order - b.order);
  const home = mappedClubs[0];
  const away = mappedClubs[1];
  const timestamp = asNumber(payload.timestamp);
  const externalMatchId = asString(payload.matchId);
  if (!externalMatchId || timestamp === undefined) {
    throw new EaFcPayloadError('EA match identity or timestamp is missing');
  }
  const playedAt = new Date(
    timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp,
  );
  if (Number.isNaN(playedAt.getTime())) {
    throw new EaFcPayloadError('EA match timestamp is invalid');
  }

  const playersByClub: Record<string, EaClubMatchPlayer[]> = {};
  for (const club of mappedClubs) {
    const rawPlayers = players[club.key] ?? players[club.id];
    if (!isRecord(rawPlayers)) {
      playersByClub[club.id] = [];
      continue;
    }
    playersByClub[club.id] = Object.entries(rawPlayers)
      .filter((entry): entry is [string, EaExternalRecord] =>
        isRecord(entry[1]),
      )
      .map(([playerId, player]) => mapPlayer(playerId, player));
  }

  return {
    externalMatchId,
    playedAt,
    homeClubId: home.id,
    awayClubId: away.id,
    homeClubName: home.name,
    awayClubName: away.name,
    homeScore: home.score,
    awayScore: away.score,
    playersByClub,
    rawData: payload,
  };
}

export function mapEaMember(value: EaExternalRecord): EaClubMember {
  const playerName = asString(value.name) ?? asString(value.playername);
  if (!playerName) throw new EaFcPayloadError('EA member name is missing');
  return {
    externalPlayerId: asString(value.playerId ?? value.blazeId),
    playerName,
    favoritePosition: asString(value.favoritePosition ?? value.proPos),
    gamesPlayed: asInteger(value.gamesPlayed),
    goals: asInteger(value.goals),
    assists: asInteger(value.assists),
    manOfTheMatch: asInteger(value.manOfTheMatch ?? value.mom),
    averageRating: asNumber(value.ratingAve ?? value.averageRating),
  };
}

export function mapEaClubOverallStats(
  value: EaExternalRecord,
): EaClubOverallStats {
  return {
    gamesPlayed: asInteger(value.gamesPlayed),
    wins: asInteger(value.wins),
    draws: asInteger(value.ties ?? value.draws),
    losses: asInteger(value.losses),
    goalsFor: asInteger(value.goals ?? value.goalsFor),
    goalsAgainst: asInteger(value.goalsAgainst),
  };
}

export function mapEaClubMemberStats(
  value: EaExternalRecord,
): EaClubMemberStats {
  const playerName = asString(value.name) ?? asString(value.playername);
  if (!playerName) throw new EaFcPayloadError('EA member name is missing');
  return {
    playerName,
    gamesPlayed: asInteger(value.gamesPlayed),
    goals: asInteger(value.goals),
    assists: asInteger(value.assists),
    manOfTheMatch: asInteger(value.manOfTheMatch ?? value.mom),
    averageRating: asNumber(value.ratingAve ?? value.averageRating),
    passesMade: asInteger(value.passesMade),
    passSuccessRate: asNumber(value.passSuccessRate),
    tacklesMade: asInteger(value.tacklesMade),
    tackleSuccessRate: asNumber(value.tackleSuccessRate),
    shotSuccessRate: asNumber(value.shotSuccessRate),
    cleanSheetsDef: asInteger(value.cleanSheetsDef),
    cleanSheetsGk: asInteger(value.cleanSheetsGK ?? value.cleanSheetsGk),
    redCards: asInteger(value.redCards),
  };
}

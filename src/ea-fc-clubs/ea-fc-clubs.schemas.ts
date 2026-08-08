import { EaExternalRecord, EaFcPayloadError } from './ea-fc-clubs.types';

export function isRecord(value: unknown): value is EaExternalRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseClubPayload(payload: unknown): EaExternalRecord {
  if (!isRecord(payload)) {
    throw new EaFcPayloadError('EA club response is not an object');
  }
  return payload;
}

export function parseMatchesPayload(payload: unknown): EaExternalRecord[] {
  if (!Array.isArray(payload)) {
    throw new EaFcPayloadError('EA matches response is not an array');
  }

  return payload.map((match, index) => {
    if (
      !isRecord(match) ||
      typeof match.matchId !== 'string' ||
      !['string', 'number'].includes(typeof match.timestamp) ||
      !isRecord(match.clubs) ||
      !isRecord(match.players)
    ) {
      throw new EaFcPayloadError(`EA match at index ${index} is malformed`);
    }
    return match;
  });
}

export function parseMembersPayload(payload: unknown): EaExternalRecord[] {
  const members = isRecord(payload) ? payload.members : undefined;
  if (!Array.isArray(members)) {
    throw new EaFcPayloadError('EA members response is malformed');
  }
  return members.filter(isRecord);
}

export function parseClubSearchPayload(payload: unknown): EaExternalRecord[] {
  if (!Array.isArray(payload)) {
    throw new EaFcPayloadError('EA club search response is not an array');
  }
  return payload.map((club, index) => {
    if (!isRecord(club)) {
      throw new EaFcPayloadError(
        `EA club search item at index ${index} is malformed`,
      );
    }
    return club;
  });
}

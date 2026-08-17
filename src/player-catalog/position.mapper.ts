const POSITION_ALIASES: Record<string, string> = {
  goalkeeper: 'GOL',
  goalie: 'GOL',
  gk: 'GOL',
  goleiro: 'GOL',
  defence: 'ZAG',
  defender: 'ZAG',
  df: 'ZAG',
  'centre-back': 'ZAG',
  'center-back': 'ZAG',
  cb: 'ZAG',
  zagueiro: 'ZAG',
  zag: 'ZAG',
  'right-back': 'LD',
  rb: 'LD',
  'lateral direito': 'LD',
  ld: 'LD',
  'left-back': 'LE',
  lb: 'LE',
  'lateral esquerdo': 'LE',
  le: 'LE',
  midfield: 'MEI',
  midfielder: 'MEI',
  mf: 'MEI',
  'central midfield': 'MC',
  'centre-midfield': 'MC',
  cm: 'MC',
  'defensive midfield': 'VOL',
  cdm: 'VOL',
  volante: 'VOL',
  vol: 'VOL',
  'attacking midfield': 'MEI',
  cam: 'MEI',
  meia: 'MEI',
  mei: 'MEI',
  offence: 'ATA',
  attacker: 'ATA',
  forward: 'ATA',
  fw: 'ATA',
  'centre-forward': 'ATA',
  striker: 'ATA',
  st: 'ATA',
  atacante: 'ATA',
  ata: 'ATA',
  'left winger': 'PE',
  lw: 'PE',
  'ponta esquerda': 'PE',
  pe: 'PE',
  'right winger': 'PD',
  rw: 'PD',
  'ponta direita': 'PD',
  pd: 'PD',
};

export const CATALOG_POSITIONS = [
  'GOL',
  'ZAG',
  'LD',
  'LE',
  'VOL',
  'MC',
  'MEI',
  'PD',
  'PE',
  'ATA',
];

export function normalizePosition(raw: string | null | undefined): string {
  if (!raw) return 'MEI';
  const key = raw
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

  if (POSITION_ALIASES[key]) return POSITION_ALIASES[key];

  const upper = key.toUpperCase();
  if (CATALOG_POSITIONS.includes(upper)) return upper;

  for (const [alias, position] of Object.entries(POSITION_ALIASES)) {
    if (key.includes(alias)) return position;
  }
  return 'MEI';
}

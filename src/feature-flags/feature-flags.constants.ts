export const FEATURE_SCREEN_SHARE = 'screen_share';
export const FEATURE_LIVE_SFU = 'live_sfu';

// Flags known by the app. Rows missing in the database are treated as disabled.
export const KNOWN_FEATURE_FLAGS: { key: string; description: string }[] = [
  {
    key: FEATURE_SCREEN_SHARE,
    description: 'Transmissão de tela ao vivo no dashboard',
  },
  {
    key: FEATURE_LIVE_SFU,
    description: 'Servidor de transmissão (SFU) para as lives',
  },
];

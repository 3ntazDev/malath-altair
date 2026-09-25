// ------------------------------------------------------------
// ملاذ الطير — Game configuration (server-side) · Developer: المبرمج فهد
// أغلب القيم قابلة للتغيير عبر متغيرات البيئة (Vercel → Environment Variables)
// ------------------------------------------------------------
const num = (name, fallback) => {
  const v = process.env[name];
  return v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : fallback;
};
const str = (name, fallback) => process.env[name] || fallback;
const bool = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
};

const PLAYER_LIMIT = 15; // الحد الأعلى المطلق الذي يفرضه الخادم

module.exports = {
  PLAYER_LIMIT,
  // ---------- Players ----------
  MIN_PLAYERS: num('MIN_PLAYERS', 4),
  MAX_PLAYERS: Math.min(PLAYER_LIMIT, num('MAX_PLAYERS', 15)),
  NAME_MIN_LENGTH: num('NAME_MIN_LENGTH', 2),
  NAME_MAX_LENGTH: num('NAME_MAX_LENGTH', 16),
  RESERVED_NAMES: ['host', 'admin', 'server', 'system', 'moderator', 'النظام', 'المشرف', 'الهوست'],
  ROOM_NAME_MAX_LENGTH: 30,
  ROOM_CODE_LENGTH: num('ROOM_CODE_LENGTH', 6),

  // ---------- Phase durations (seconds) ----------
  ROUND_START_DURATION: num('ROUND_START_DURATION', 5),
  CHAT_DURATION: num('CHAT_DURATION', 300),
  ABILITY_DURATION: num('ABILITY_DURATION', 30),
  VOTING_DURATION: num('VOTING_DURATION', 60),
  LAST_STAND_DURATION: num('LAST_STAND_DURATION', 10),
  VOTE_RESULT_DURATION: num('VOTE_RESULT_DURATION', 8),
  ELIMINATION_DURATION: num('ELIMINATION_DURATION', 6),

  // ---------- Chat ----------
  CHAT_PHASES: ['PRIVATE_CHAT'],
  MESSAGE_MAX_LENGTH: 400,
  MESSAGE_RATE_LIMIT: { count: 8, windowMs: 5000 },

  // ---------- Voting ----------
  TIE_RULE: str('TIE_RULE', 'RANDOM'), // RANDOM | NO_ELIMINATION | REVOTE
  MAX_REVOTES: 1,
  ALLOW_SELF_VOTE: false,
  REVEAL_VOTE_COUNTS: true,
  REVEAL_ELIMINATED_PLAYER: true,

  // ---------- Spectators ----------
  ALLOW_SPECTATORS: bool('ALLOW_SPECTATORS', true),

  // ---------- Win ----------
  // تنتهي المباراة فورًا عند بقاء survivors لاعبين، وكلهم فائزون.
  WIN_CONDITION: { type: 'LAST_STANDING', survivors: num('WIN_SURVIVORS', 2) },
  MAX_ROUNDS: num('MAX_ROUNDS', 30),

  // ---------- Abilities ----------
  SPY_ENABLED: bool('SPY_ENABLED', true),
  ABILITY_POOL: [{ type: 'SPY', weight: 1 }],
  SPY_ALLOW_ELIMINATED_TARGETS: false,
  LAST_STAND_ENABLED: bool('LAST_STAND_ENABLED', true),
  LAST_STAND_OWNERS: 2,
  LAST_STAND_REVEAL: true,

  // ---------- Host admin ----------
  HOST_PAUSE_ENABLED: bool('HOST_PAUSE_ENABLED', true),

  // ---------- Presence (serverless: heartbeat-based) ----------
  HEARTBEAT_MS: num('HEARTBEAT_MS', 15_000), // كل كم يرسل المتصفح نبضة
  PRESENCE_TIMEOUT_MS: num('PRESENCE_TIMEOUT_MS', 40_000), // بعدها يعتبر اللاعب غير متصل
  LOBBY_DISCONNECT_TIMEOUT_MS: num('LOBBY_DISCONNECT_TIMEOUT_MS', 90_000), // حجز المكان في الـLobby
  EMPTY_ROOM_TTL_MS: num('EMPTY_ROOM_TTL_MS', 30 * 60_000),

  // ---------- Host-editable (validated server-side) ----------
  HOST_EDITABLE: {
    MIN_PLAYERS: [3, PLAYER_LIMIT],
    MAX_PLAYERS: [3, PLAYER_LIMIT],
    CHAT_DURATION: [30, 900],
    ABILITY_DURATION: [10, 120],
    VOTING_DURATION: [15, 300],
    LAST_STAND_DURATION: [5, 30],
    TIE_RULE: ['RANDOM', 'NO_ELIMINATION', 'REVOTE'],
    ALLOW_SPECTATORS: [true, false],
    SPY_ENABLED: [true, false],
    LAST_STAND_ENABLED: [true, false],
  },
};

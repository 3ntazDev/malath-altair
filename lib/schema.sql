-- Island Betrayal — PostgreSQL schema (idempotent; runs automatically on first request)

CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY,
  token_hash      TEXT UNIQUE NOT NULL,
  name            VARCHAR(32) NOT NULL,
  character_id    TEXT,
  current_game_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS characters (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  title     TEXT,
  image     TEXT NOT NULL,
  portrait  TEXT NOT NULL
);

-- games: الحالة المرجعية للغرفة (JSONB) تُقفل بـ SELECT ... FOR UPDATE في كل Action
CREATE TABLE IF NOT EXISTS games (
  id          UUID PRIMARY KEY,
  code        TEXT UNIQUE,              -- NULL بعد إغلاق الغرفة
  status      TEXT NOT NULL,            -- LOBBY | IN_GAME | GAME_OVER | CLOSED
  state       JSONB NOT NULL,
  version     INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_players (
  game_id       UUID NOT NULL,
  match_id      UUID NOT NULL,
  player_id     UUID NOT NULL,
  character_id  TEXT NOT NULL,
  status        TEXT NOT NULL,
  is_host       BOOLEAN NOT NULL,
  joined_at     TIMESTAMPTZ,
  PRIMARY KEY (match_id, player_id),
  UNIQUE (match_id, character_id)
);

CREATE TABLE IF NOT EXISTS rounds (
  match_id    UUID NOT NULL,
  round       INTEGER NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (match_id, round)
);

CREATE TABLE IF NOT EXISTS messages (
  id           UUID PRIMARY KEY,
  game_id      UUID NOT NULL,
  match_id     UUID NOT NULL,
  sender_id    UUID NOT NULL,
  receiver_id  UUID NOT NULL,
  body         VARCHAR(400) NOT NULL,
  round        INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_match_sender ON messages (match_id, sender_id);
CREATE INDEX IF NOT EXISTS messages_match_receiver ON messages (match_id, receiver_id);
-- معرف الرسالة من المتصفح: يمنع التكرار عند إعادة الإرسال ويسمح بالعرض الفوري
ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS messages_client ON messages (match_id, sender_id, client_id);
CREATE INDEX IF NOT EXISTS messages_sender_time ON messages (sender_id, created_at);

CREATE TABLE IF NOT EXISTS votes (
  id          UUID PRIMARY KEY,
  game_id     UUID NOT NULL,
  match_id    UUID NOT NULL,
  round       INTEGER NOT NULL,
  attempt     INTEGER NOT NULL,
  voter_id    UUID NOT NULL,
  target_id   UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL,
  UNIQUE (match_id, round, attempt, voter_id)
);

CREATE TABLE IF NOT EXISTS abilities (
  match_id   UUID NOT NULL,
  round      INTEGER NOT NULL,   -- 0 = ability للمباراة كاملة (LAST_STAND)
  holder_id  UUID NOT NULL,
  type       TEXT NOT NULL,
  PRIMARY KEY (match_id, round, holder_id, type)
);

CREATE TABLE IF NOT EXISTS ability_uses (
  id          BIGSERIAL PRIMARY KEY,
  match_id    UUID NOT NULL,
  round       INTEGER NOT NULL,
  user_id     UUID NOT NULL,
  type        TEXT NOT NULL,
  input       JSONB,
  created_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS game_events (
  id          BIGSERIAL PRIMARY KEY,
  game_id     UUID NOT NULL,
  match_id    UUID,
  type        TEXT NOT NULL,
  data        JSONB,
  created_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS game_events_game ON game_events (game_id, id);

-- سجل إجراءات الـHost
CREATE TABLE IF NOT EXISTS host_actions (
  id                BIGSERIAL PRIMARY KEY,
  game_id           UUID NOT NULL,
  host_id           UUID NOT NULL,
  action            TEXT NOT NULL,
  target_player_id  UUID,
  created_at        TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS host_actions_game ON host_actions (game_id, id);

CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Supabase: أغلق الوصول عبر REST API العام (anon/authenticated).
-- خادم اللعبة يتصل كمالك الجداول فلا يتأثر.
ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE characters     ENABLE ROW LEVEL SECURITY;
ALTER TABLE games          ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_players   ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds         ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE abilities      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ability_uses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE host_actions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_meta       ENABLE ROW LEVEL SECURITY;

// ------------------------------------------------------------
// Rooms — تحميل/حفظ حالة الغرفة داخل Transaction مع قفل الصف.
// كل Action:
//   BEGIN → SELECT ... FOR UPDATE → advance(وقت الخادم) → action
//   → حفظ الحالة + الإدخالات (messages, votes, events...) → COMMIT
//   → نشر الإشعارات عبر Realtime (بعد الـCOMMIT فقط)
// إذا فشل الـAction تُعاد الحالة كما كانت قبله (مع الإبقاء على advance).
// ------------------------------------------------------------
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const realtime = require('./realtime');
const { GameError } = require('./errors');
const { Game, newRoomState, newCtx, uid } = require('./game/engine');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => Array.from({ length: config.ROOM_CODE_LENGTH }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');

function repo(client) {
  return {
    async pairMessages(matchId, a, b) {
      const r = await client.query(
        `SELECT sender_id, receiver_id, body, round, created_at FROM messages
         WHERE match_id=$1 AND ((sender_id=$2 AND receiver_id=$3) OR (sender_id=$3 AND receiver_id=$2))
         ORDER BY created_at, id`,
        [matchId, a, b]
      );
      return r.rows.map((x) => ({ senderId: x.sender_id, receiverId: x.receiver_id, text: x.body, round: x.round, createdAt: new Date(x.created_at).getTime() }));
    },
  };
}

function statusOf(S) {
  if (S.closed) return 'CLOSED';
  if (S.phase === 'LOBBY') return 'LOBBY';
  if (S.phase === 'GAME_OVER') return 'GAME_OVER';
  return 'IN_GAME';
}

async function flushSql(client, ctx) {
  for (const [text, params] of ctx.sql) await client.query(text, params);
  ctx.sql.length = 0;
}

async function persist(client, game, rowId, isNew) {
  const S = game.S;
  if (isNew) {
    await client.query('INSERT INTO games (id, code, status, state, version) VALUES ($1,$2,$3,$4,1)', [S.id, S.code, statusOf(S), JSON.stringify(S)]);
  } else {
    await client.query('UPDATE games SET state=$2, status=$3, code=$4, version=version+1, updated_at=now() WHERE id=$1', [
      rowId, JSON.stringify(S), statusOf(S), S.closed ? null : S.code,
    ]);
  }
}

// نشر الإشعارات بعد الـCOMMIT. الإشعار "sync" لا يحمل بيانات سرية.
async function publish(game, ctx, extraRecipients = []) {
  const members = Object.keys(game.S.members);
  const jobs = [];
  const rev = game.S.rev;
  if (ctx.notifyAll) jobs.push(realtime.publish([...members, ...extraRecipients], 'sync', { rev }));
  else if (ctx.notifyUsers.size) jobs.push(realtime.publish([...ctx.notifyUsers], 'sync', { rev }));
  for (const e of ctx.events) jobs.push(realtime.publish(e.userIds, e.event, e.data));
  const res = await Promise.allSettled(jobs);
  for (const r of res) if (r.status === 'rejected') console.error('[realtime] publish failed:', r.reason && r.reason.message);
}

/**
 * يشغّل fn(game, repo) على غرفة مقفلة.
 * @returns نتيجة fn، أو يرمي GameError
 */
async function withRoom(gameId, fn) {
  if (!gameId) throw new GameError('NOT_IN_ROOM', 'أنت لست في غرفة.');
  let game;
  let ctx;
  let result;
  let error = null;
  await db.tx(async (client) => {
    const r = await client.query("SELECT id, state FROM games WHERE id=$1 AND status <> 'CLOSED' FOR UPDATE", [gameId]);
    if (!r.rows.length) throw new GameError('ROOM_NOT_FOUND', 'الغرفة لم تعد موجودة.');
    ctx = newCtx(Date.now());
    game = new Game(r.rows[0].state, ctx);
    game.advance();

    // لقطة بعد advance — للتراجع إن فشل الـAction
    const snap = { state: JSON.stringify(game.S), sql: ctx.sql.length, events: ctx.events.length, all: ctx.notifyAll, users: new Set(ctx.notifyUsers), dirty: ctx.dirty };
    try {
      result = await fn(game, repo(client));
    } catch (e) {
      error = e;
      game.S = JSON.parse(snap.state);
      ctx.sql.length = snap.sql;
      ctx.events.length = snap.events;
      ctx.notifyAll = snap.all;
      ctx.notifyUsers = snap.users;
      ctx.dirty = snap.dirty;
    }
    await flushSql(client, ctx);
    if (ctx.dirty) await persist(client, game, gameId, false);
  });
  await publish(game, ctx);
  if (error) throw error;
  return result;
}

async function createRoom(user, { settings, roomName }) {
  const now = Date.now();
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genCode();
    const ctx = newCtx(now);
    const state = newRoomState({ id: uid(), code, host: user, now });
    const game = new Game(state, ctx);
    game.log('GAME_CREATED', { code, hostId: user.id });
    if (settings) game.applySettings(settings);
    if (roomName !== undefined) game.setRoomName(roomName);
    game.addMember(user);
    try {
      await db.tx(async (client) => {
        await persist(client, game, null, true);
        await flushSql(client, ctx);
      });
      return game;
    } catch (e) {
      if (e.code === '23505') { lastErr = e; continue; } // code collision → retry
      throw e;
    }
  }
  throw lastErr;
}

async function findByCode(code) {
  const r = await db.query("SELECT id FROM games WHERE code=$1 AND status <> 'CLOSED'", [code]);
  return r.rows[0] ? r.rows[0].id : null;
}

async function messagesFor(gameId, matchId, userId) {
  const r = await db.query(
    `SELECT id, client_id, sender_id, receiver_id, body, round, created_at FROM messages
     WHERE game_id=$1 AND match_id=$2 AND (sender_id=$3 OR receiver_id=$3) ORDER BY created_at, id`,
    [gameId, matchId, userId]
  );
  return r.rows.map((x) => ({ id: x.id, clientId: x.client_id, senderId: x.sender_id, receiverId: x.receiver_id, text: x.body, round: x.round, createdAt: new Date(x.created_at).getTime() }));
}

module.exports = { withRoom, createRoom, findByCode, messagesFor };

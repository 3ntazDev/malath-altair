// ------------------------------------------------------------
// API — Router واحد يعمل كـVercel Function وفي خادم التطوير المحلي.
// كل الطلبات (عدا config) تتطلب Authorization: Bearer <session token>
// ------------------------------------------------------------
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const realtime = require('./realtime');
const { GameError } = require('./errors');
const { CHARACTERS, isValidCharacter } = require('./characters');
const { withRoom, createRoom, findByCode, messagesFor } = require('./rooms');
const { buildView } = require('./game/views');
const { Game, newCtx } = require('./game/engine');
const chat = require('./chat');

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const publicUser = (u) => ({ id: u.id, name: u.name, characterId: isValidCharacter(u.character_id) ? u.character_id : null });

function validateName(raw) {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!name) throw new GameError('NAME_EMPTY', 'اكتب اسمك.');
  if (name.length < config.NAME_MIN_LENGTH || name.length > config.NAME_MAX_LENGTH) {
    throw new GameError('NAME_LENGTH', `الاسم بين ${config.NAME_MIN_LENGTH} و ${config.NAME_MAX_LENGTH} حرفًا.`);
  }
  if (/[<>{}\\]/.test(name)) throw new GameError('NAME_INVALID', 'الاسم يحتوي على رموز غير مسموحة.');
  if (config.RESERVED_NAMES.includes(name.toLowerCase())) throw new GameError('NAME_RESERVED', 'هذا الاسم محجوز. اختر اسمًا آخر.');
  return name;
}

async function auth(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token || token.length < 20) throw new GameError('NO_SESSION', 'انتهت الجلسة. أدخل اسمك من جديد.');
  const r = await db.query('SELECT * FROM users WHERE token_hash=$1', [sha(token)]);
  if (!r.rows.length) throw new GameError('NO_SESSION', 'انتهت الجلسة. أدخل اسمك من جديد.');
  return r.rows[0];
}

// الشروط الإلزامية قبل Create/Join: اسم + شخصية
function requireProfile(user) {
  if (!user.name) throw new GameError('NO_NAME', 'أدخل اسمك أولًا.');
  if (!isValidCharacter(user.character_id)) throw new GameError('NO_CHARACTER', 'اختر شخصيتك أولًا.');
}

async function currentRoomOf(user) {
  if (!user.current_game_id) return null;
  const r = await db.query("SELECT state->'members' ? $2 AS member FROM games WHERE id=$1 AND status <> 'CLOSED'", [user.current_game_id, user.id]);
  if (r.rows[0] && r.rows[0].member) return user.current_game_id;
  await db.query('UPDATE users SET current_game_id=NULL WHERE id=$1', [user.id]);
  return null;
}

const inRoom = (user, fn) => withRoom(user.current_game_id, (game, repo) => {
  if (!game.S.members[user.id]) throw new GameError('NOT_IN_ROOM', 'أنت لست في هذه الغرفة.');
  game.touch(user.id);
  return fn(game, repo);
});

const routes = {
  // ---------- public ----------
  'GET config': async () => {
    const defaults = {};
    for (const k of Object.keys(config.HOST_EDITABLE)) defaults[k] = config[k];
    return {
      realtime: realtime.clientConfig(),
      characters: CHARACTERS,
      roomDefaults: defaults,
      editable: config.HOST_EDITABLE,
      limits: { playerLimit: config.PLAYER_LIMIT, nameMin: config.NAME_MIN_LENGTH, nameMax: config.NAME_MAX_LENGTH, codeLength: config.ROOM_CODE_LENGTH },
      heartbeatMs: config.HEARTBEAT_MS,
    };
  },

  // فحص سريع بعد النشر: https://<your-app>.vercel.app/api/health
  'GET health': async () => {
    const t = Date.now();
    let dbOk = false;
    let dbError = null;
    try {
      await db.query('SELECT 1');
      dbOk = true;
    } catch (e) {
      dbError = e.code || e.message;
    }
    return {
      game: 'ملاذ الطير',
      database: dbOk ? 'ok' : `error: ${dbError}`,
      databaseMs: Date.now() - t,
      realtime: realtime.name === 'pusher' ? 'pusher ✓' : realtime.name === 'none' ? 'polling fallback — أضف متغيرات PUSHER_*' : realtime.name,
      region: process.env.VERCEL_REGION || 'local',
    };
  },

  // ---------- session ----------
  'POST session/register': async (req, body) => {
    const name = validateName(body.name);
    const token = crypto.randomBytes(32).toString('hex');
    const id = crypto.randomUUID();
    await db.query('INSERT INTO users (id, token_hash, name) VALUES ($1,$2,$3)', [id, sha(token), name]);
    return { token, user: { id, name, characterId: null } };
  },
  'POST session/resume': async (req) => {
    const user = await auth(req);
    const gameId = await currentRoomOf(user);
    return { user: publicUser(user), inRoom: !!gameId };
  },
  'POST session/name': async (req, body) => {
    const user = await auth(req);
    if (await currentRoomOf(user)) throw new GameError('IN_ROOM', 'اخرج من الغرفة لتغيير اسمك.');
    const name = validateName(body.name);
    await db.query('UPDATE users SET name=$2, updated_at=now() WHERE id=$1', [user.id, name]);
    return { user: { ...publicUser(user), name } };
  },
  'POST session/character': async (req, body) => {
    const user = await auth(req);
    if (!isValidCharacter(body.characterId)) throw new GameError('INVALID_CHARACTER', 'شخصية غير موجودة.');
    if (await currentRoomOf(user)) {
      await inRoom(user, (g) => g.setCharacter(user.id, body.characterId));
    }
    await db.query('UPDATE users SET character_id=$2, updated_at=now() WHERE id=$1', [user.id, body.characterId]);
    return { user: { ...publicUser(user), characterId: body.characterId } };
  },

  // ---------- rooms ----------
  'POST room/create': async (req, body) => {
    const user = await auth(req);
    requireProfile(user);
    if (await currentRoomOf(user)) throw new GameError('IN_ROOM', 'أنت بالفعل داخل غرفة.');
    const game = await createRoom(user, { settings: body.settings, roomName: body.roomName });
    return { code: game.S.code };
  },
  'POST room/join': async (req, body) => {
    const user = await auth(req);
    requireProfile(user);
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (!/^[A-Z0-9]{4,8}$/.test(code)) throw new GameError('ROOM_NOT_FOUND', 'رمز غير صالح.');
    const current = await currentRoomOf(user);
    const gameId = await findByCode(code);
    if (!gameId) throw new GameError('ROOM_NOT_FOUND', 'لا توجد غرفة بهذا الرمز. تأكد من الرمز وحاول مجددًا.');
    if (current && current !== gameId) throw new GameError('IN_ROOM', 'أنت بالفعل داخل غرفة أخرى.');
    await withRoom(gameId, (game) => {
      if (game.S.phase === 'LOBBY' && game.isAbandoned()) {
        game.destroy('ABANDONED');
        throw new GameError('ROOM_NOT_FOUND', 'هذه الغرفة لم تعد نشطة.');
      }
      if (game.S.members[user.id]) return game.touch(user.id);
      game.addMember(user);
    });
    return { code };
  },
  'POST room/character': async (req, body) => {
    const user = await auth(req);
    await inRoom(user, (g) => g.setCharacter(user.id, body.characterId));
    await db.query('UPDATE users SET character_id=$2 WHERE id=$1', [user.id, body.characterId]);
    return {};
  },
  'POST room/settings': async (req, body) => {
    const user = await auth(req);
    await inRoom(user, (g) => g.updateSettings(user.id, body.settings, body.roomName));
    return {};
  },
  'POST room/join-open': async (req, body) => {
    const user = await auth(req);
    await inRoom(user, (g) => g.setJoinOpen(user.id, body.open === true));
    return {};
  },
  'POST room/kick': async (req, body) => {
    const user = await auth(req);
    await inRoom(user, (g) => g.removePlayer(user.id, body.playerId));
    return {};
  },
  'POST room/start': async (req) => {
    const user = await auth(req);
    await inRoom(user, (g) => g.startMatch(user.id));
    return {};
  },
  'POST room/close': async (req) => {
    const user = await auth(req);
    await inRoom(user, (g) => g.close(user.id));
    return {};
  },
  'POST room/leave': async (req) => {
    const user = await auth(req);
    if (!(await currentRoomOf(user))) return {};
    await withRoom(user.current_game_id, (g) => g.removeMember(user.id, 'LEFT'));
    return {};
  },

  // ---------- game ----------
  // Sync = نبضة الحضور + تقدم الوقت + نسخة اللاعب من الحالة
  // المسار السريع: استعلام واحد (الجلسة + الغرفة) بدون قفل عندما لا يتغير شيء.
  // المسار الكامل (قفل + حفظ) فقط عند انتهاء مرحلة أو تغيّر حضور.
  'POST sync': async (req) => {
    const r = await db.query(
      `SELECT u.*, g.state AS gstate FROM users u
         LEFT JOIN games g ON g.id = u.current_game_id AND g.status <> 'CLOSED'
        WHERE u.token_hash = $1`,
      [chat.sha(chat.tokenOf(req))]
    );
    const user = r.rows[0];
    if (!user) throw new GameError('NO_SESSION', 'انتهت الجلسة. أدخل اسمك من جديد.');
    if (!user.gstate || !user.gstate.members[user.id]) {
      if (user.current_game_id) await db.query('UPDATE users SET current_game_id=NULL WHERE id=$1', [user.id]);
      return { inRoom: false };
    }
    const ctx = newCtx(Date.now());
    const fast = new Game(user.gstate, ctx);
    fast.advance();
    fast.touch(user.id);
    let view;
    if (!ctx.dirty) view = buildView(fast, user.id);
    else {
      try {
        view = await inRoom(user, (g) => buildView(g, user.id));
      } catch (e) {
        if (e.code === 'NOT_IN_ROOM' || e.code === 'ROOM_NOT_FOUND') return { inRoom: false };
        throw e;
      }
    }
    if (view.match && view.match.stats) {
      const counts = await chat.messageCounts(view.match.id);
      for (const st of view.match.stats) st.messagesSent = counts.get(st.id) || 0;
    }
    return { inRoom: true, view };
  },
  'POST chat/send': async (req, body) => ({ message: await chat.sendMessage(req, body) }),
  'POST chat/history': async (req) => {
    const user = await auth(req);
    const gameId = await currentRoomOf(user);
    if (!gameId) return { messages: [] };
    const r = await db.query("SELECT state->'match'->>'id' AS match_id, (state->'match'->'players') ? $2 AS player FROM games WHERE id=$1", [gameId, user.id]);
    const row = r.rows[0];
    if (!row || !row.match_id || !row.player) return { messages: [] };
    return { messages: await messagesFor(gameId, row.match_id, user.id) };
  },
  'POST ability/use': async (req, body) => {
    const user = await auth(req);
    const result = await inRoom(user, (g, repo) => g.useAbility(user.id, body.input, repo));
    return { result };
  },
  'POST last-stand': async (req, body) => {
    const user = await auth(req);
    await inRoom(user, (g) => g.decideLastStand(user.id, body.use === true));
    return {};
  },
  'POST vote': async (req, body) => {
    const user = await auth(req);
    await inRoom(user, (g) => g.castVote(user.id, body.targetId));
    return {};
  },
  'POST match/end': async (req) => {
    const user = await auth(req);
    await inRoom(user, (g) => g.endByHost(user.id));
    return {};
  },
  'POST match/pause': async (req) => {
    const user = await auth(req);
    await inRoom(user, (g) => g.pause(user.id));
    return {};
  },
  'POST match/resume': async (req) => {
    const user = await auth(req);
    await inRoom(user, (g) => g.resume(user.id));
    return {};
  },
  'POST match/again': async (req) => {
    const user = await auth(req);
    await inRoom(user, (g) => g.playAgain(user.id));
    return {};
  },
  'POST match/lobby': async (req) => {
    const user = await auth(req);
    await inRoom(user, (g) => g.returnToLobby(user.id));
    return {};
  },

  // ---------- realtime ----------
  'POST realtime/auth': async (req, body) => {
    const user = await auth(req);
    const channel = body.channel_name;
    // كل لاعب يستطيع الاشتراك في قناته فقط
    if (channel !== realtime.channelFor(user.id)) throw new GameError('FORBIDDEN', 'غير مسموح.');
    return { __raw: realtime.authorize(body.socket_id, channel) };
  },
};

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return parse(req.body, req.headers['content-type']);
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw new GameError('TOO_LARGE', 'الطلب كبير جدًا.');
    chunks.push(c);
  }
  return parse(Buffer.concat(chunks).toString('utf8'), req.headers['content-type']);
}
function parse(text, type = '') {
  if (!text) return {};
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    throw new GameError('BAD_JSON', 'طلب غير صالح.');
  }
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function routePath(req) {
  const url = new URL(req.url, 'http://x');
  const p = url.searchParams.get('path') || url.pathname.replace(/^\/api\/?/, '');
  return p.replace(/^\/+|\/+$/g, '');
}

async function handler(req, res) {
  const key = `${req.method} ${routePath(req)}`;
  const fn = routes[key];
  if (!fn) return send(res, 404, { ok: false, code: 'NOT_FOUND', error: 'Not found' });
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    const out = await fn(req, body);
    if (out && out.__raw) return send(res, 200, out.__raw);
    send(res, 200, { ok: true, ...(out || {}) });
  } catch (e) {
    if (e instanceof GameError) {
      const status = e.code === 'NO_SESSION' ? 401 : ['FORBIDDEN', 'NOT_IN_ROOM', 'KICKED'].includes(e.code) ? 403 : 400;
      return send(res, status, { ok: false, code: e.code, error: e.message, ...(e.extra || {}) });
    }
    console.error(`[api] ${key}`, e);
    send(res, 500, { ok: false, code: 'INTERNAL', error: 'حدث خطأ في الخادم. حاول مجددًا.' });
  }
}

module.exports = { handler, auth, routes };

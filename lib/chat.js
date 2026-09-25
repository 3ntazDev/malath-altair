// ------------------------------------------------------------
// Private Chat — المسار السريع
//   1) استعلام واحد: الجلسة + حالة الغرفة المطلوبة + حد السرعة
//   2) استعلام واحد: إدراج الرسالة + سجل الحدث، مشروط ذريًا بأن
//      مرحلة المحادثات ما زالت مفتوحة (وقت الخادم)
//   3) نشر الرسالة لقناتي المرسل والمستقبل فقط
// لا يقفل صف الغرفة، فلا تتأخر الرسائل بسبب التصويت أو التحديثات.
// ------------------------------------------------------------
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const realtime = require('./realtime');
const { GameError } = require('./errors');

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tokenOf(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (token.length < 20) throw new GameError('NO_SESSION', 'انتهت الجلسة. أدخل اسمك من جديد.');
  return token;
}

async function sendMessage(req, body) {
  const to = typeof body.to === 'string' && UUID.test(body.to) ? body.to : null;
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const clientId = typeof body.clientId === 'string' && /^[\w-]{8,64}$/.test(body.clientId) ? body.clientId : crypto.randomUUID();
  if (!text) throw new GameError('EMPTY', 'الرسالة فارغة.');
  if (text.length > config.MESSAGE_MAX_LENGTH) throw new GameError('TOO_LONG', `الحد الأقصى ${config.MESSAGE_MAX_LENGTH} حرف.`);
  const { count, windowMs } = config.MESSAGE_RATE_LIMIT;

  // (1) الجلسة + لقطة الحالة + حد السرعة — رحلة واحدة
  const r = await db.query(
    `SELECT u.id::text AS uid, g.id::text AS gid,
            g.state->>'phase' AS phase,
            COALESCE(g.state->'paused', 'null'::jsonb) <> 'null'::jsonb AS paused,
            (g.state->>'phaseEndsAt')::bigint AS ends,
            g.state->'settings'->'CHAT_PHASES' AS chat_phases,
            g.state->'match'->>'id' AS mid,
            (g.state->'match'->>'round')::int AS round,
            (g.state->'members') ? u.id::text AS member,
            g.state->'match'->'players'->(u.id::text)->>'status' AS my_status,
            g.state->'match'->'players'->$2::text->>'status' AS to_status,
            (SELECT count(*)::int FROM messages mm WHERE mm.sender_id = u.id AND mm.created_at > now() - ($3::int * interval '1 millisecond')) AS recent
       FROM users u
       LEFT JOIN games g ON g.id = u.current_game_id AND g.status <> 'CLOSED'
      WHERE u.token_hash = $1`,
    [sha(tokenOf(req)), to || '', windowMs]
  );
  const s = r.rows[0];
  if (!s) throw new GameError('NO_SESSION', 'انتهت الجلسة. أدخل اسمك من جديد.');
  if (!s.gid || !s.member) throw new GameError('NOT_IN_ROOM', 'أنت لست في غرفة.');
  if (!s.mid || s.phase === 'LOBBY' || s.phase === 'GAME_OVER') throw new GameError('NO_MATCH', 'لا توجد مباراة قائمة.');
  const now = Date.now();
  if (s.paused) throw new GameError('PAUSED', 'اللعبة متوقفة مؤقتًا من الـHost.');
  if (!(s.chat_phases || []).includes(s.phase) || !s.ends || s.ends <= now) throw new GameError('WRONG_PHASE', 'المحادثات مغلقة في هذه المرحلة.');
  if (s.my_status !== 'ALIVE') throw new GameError('ELIMINATED', 'تم إقصاؤك ولا يمكنك التأثير على المباراة.');
  if (!to || to === s.uid || s.to_status !== 'ALIVE') throw new GameError('INVALID_TARGET', 'لا يمكن إرسال الرسالة لهذا اللاعب.');
  if (s.recent >= count) throw new GameError('RATE_LIMIT', 'أنت ترسل بسرعة كبيرة. انتظر لحظة.');

  // (2) الإدراج مشروط ذريًا بأن المرحلة لم تتغير — رحلة واحدة
  const id = crypto.randomUUID();
  const at = new Date(now).toISOString();
  const w = await db.query(
    `WITH ok AS (
        SELECT 1 FROM games
         WHERE id = $2::uuid AND state->>'phase' = $10::text AND state->'match'->>'id' = $3::uuid::text
           AND COALESCE((state->>'phaseEndsAt')::bigint, 0) > $11::bigint
           AND COALESCE(state->'paused', 'null'::jsonb) = 'null'::jsonb
     ), ins AS (
        INSERT INTO messages (id, game_id, match_id, sender_id, receiver_id, body, round, created_at, client_id)
        SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::text, $7::int, $8::timestamptz, $9::text FROM ok
        ON CONFLICT (match_id, sender_id, client_id) DO NOTHING
        RETURNING id
     ), ev AS (
        INSERT INTO game_events (game_id, match_id, type, data, created_at)
        SELECT $2::uuid, $3::uuid, 'MESSAGE_SENT', $12::jsonb, $8::timestamptz FROM ins
     )
     SELECT (SELECT count(*)::int FROM ok) AS ok, (SELECT count(*)::int FROM ins) AS inserted`,
    [id, s.gid, s.mid, s.uid, to, text, s.round, at, clientId, s.phase, now,
      JSON.stringify({ senderId: s.uid, receiverId: to, messageId: id })]
  );
  const res = w.rows[0];
  if (!res.ok) throw new GameError('WRONG_PHASE', 'المحادثات مغلقة في هذه المرحلة.');

  let msg = { id, clientId, senderId: s.uid, receiverId: to, text, round: s.round, createdAt: now };
  if (!res.inserted) {
    // نفس clientId أُرسل من قبل (إعادة محاولة) — أعد الرسالة الأصلية بدون تكرار
    const e = await db.query('SELECT id, created_at FROM messages WHERE match_id=$1 AND sender_id=$2 AND client_id=$3', [s.mid, s.uid, clientId]);
    if (e.rows[0]) msg = { ...msg, id: e.rows[0].id, createdAt: new Date(e.rows[0].created_at).getTime() };
    return msg;
  }
  // (3) للطرفين فقط
  try {
    await realtime.publish([s.uid, to], 'chat', msg);
  } catch (err) {
    console.error('[realtime] chat publish failed:', err && err.message);
  }
  return msg;
}

// عدد الرسائل لكل لاعب (لإحصائيات نهاية المباراة)
async function messageCounts(matchId) {
  const r = await db.query('SELECT sender_id::text AS id, count(*)::int AS n FROM messages WHERE match_id=$1 GROUP BY sender_id', [matchId]);
  return new Map(r.rows.map((x) => [x.id, x.n]));
}

module.exports = { sendMessage, messageCounts, tokenOf, sha };

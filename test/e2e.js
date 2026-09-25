// E2E: HTTP API + Postgres + SSE realtime.
// DATABASE_URL=postgres://... node test/e2e.js
Object.assign(process.env, {
  ROUND_START_DURATION: '0.3', CHAT_DURATION: '1.2', ABILITY_DURATION: '0.8', VOTING_DURATION: '1.5',
  LAST_STAND_DURATION: '0.8', VOTE_RESULT_DURATION: '0.2', ELIMINATION_DURATION: '0.2', PORT: '3998',
});
delete process.env.PUSHER_KEY;
const assert = require('assert');
const http = require('http');
const { server } = require('../scripts/dev');
const db = require('../lib/db');

const BASE = 'http://localhost:3998';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(bot, path, body = {}) {
  const r = await fetch(`${BASE}/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(bot && bot.token ? { Authorization: `Bearer ${bot.token}` } : {}) },
    body: JSON.stringify(body),
  });
  return r.json();
}
function listen(bot) {
  return new Promise((resolve) => {
    const req = http.get(`${BASE}/api/realtime/stream?token=${bot.token}`, (res) => {
      let buf = '';
      res.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /event: (.*)/.exec(chunk);
          const data = /data: (.*)/.exec(chunk);
          if (ev && data) bot.events.push({ event: ev[1], data: JSON.parse(data[1]) });
        }
      });
      resolve();
    });
    bot.req = req;
  });
}
async function mkBot(name, ch) {
  const r = await api(null, 'session/register', { name });
  assert(r.ok, r.error);
  const bot = { name, token: r.token, id: r.user.id, events: [], view: null };
  assert((await api(bot, 'session/character', { characterId: ch })).ok);
  await listen(bot);
  return bot;
}
const sync = async (b) => {
  const r = await api(b, 'sync');
  b.view = r.inRoom ? r.view : null;
  return b.view;
};
const syncAll = (bots) => Promise.all(bots.map(sync));
async function until(bots, pred, ms = 10000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    await syncAll(bots);
    if (pred()) return;
    await sleep(60);
  }
  throw new Error('timeout');
}
const CH = ['saqr', 'jabal', 'shaheen', 'hakeem', 'sultan', 'qadi', 'riven', 'kael', 'mira', 'nox', 'ayla', 'raven', 'kairo', 'luna', 'zane', 'vera', 'sora', 'ember'].map((s) => `char_${s}`);

(async () => {
  await new Promise((r) => server.listen(3998, r));
  await db.query('TRUNCATE users, games, host_actions, game_players, rounds, messages, votes, abilities, ability_uses, game_events');

  // ---------- entry flow gating ----------
  const bare = await api(null, 'session/register', { name: 'Solo' });
  assert.strictEqual((await api({ token: bare.token }, 'room/create')).code, 'NO_CHARACTER', 'create requires character');
  assert.strictEqual((await api(null, 'session/register', { name: ' ' })).code, 'NAME_EMPTY');
  assert.strictEqual((await api(null, 'session/register', { name: 'admin' })).code, 'NAME_RESERVED');
  assert.strictEqual((await api({ token: 'x'.repeat(64) }, 'sync')).code, 'NO_SESSION');

  // ---------- 15-player capacity + race ----------
  const crowd = [];
  for (let i = 0; i < 17; i++) crowd.push(await mkBot(`P${i}`, CH[i]));
  assert.strictEqual((await api(crowd[0], 'room/create', { settings: { MAX_PLAYERS: 16 } })).code, 'INVALID', 'max 15 enforced');
  const big = await api(crowd[0], 'room/create', { roomName: 'Big', settings: { MAX_PLAYERS: 15 } });
  assert(big.ok && big.code.length === 6);
  // 16 players try to join at the same time → exactly 14 succeed (host + 14 = 15)
  const results = await Promise.all(crowd.slice(1, 17).map((b) => api(b, 'room/join', { code: big.code })));
  assert.strictEqual(results.filter((r) => r.ok).length, 14, 'exactly 15 in room');
  assert(results.filter((r) => !r.ok).every((r) => r.code === 'ROOM_FULL'));
  await sync(crowd[0]);
  assert.strictEqual(crowd[0].view.room.members.length, 15);
  assert.strictEqual(crowd[0].view.room.full, true);
  assert((await api(crowd[0], 'room/start')).ok);
  await until([crowd[0]], () => crowd[0].view.room.phase === 'PRIVATE_CHAT');
  const inBig = crowd.filter((b, i) => i === 0 || results[i - 1].ok);
  await syncAll(inBig);
  assert.strictEqual(inBig.filter((b) => b.view.match.lastStand).length, 2, '2 LAST STAND owners in 15p game');
  assert.strictEqual(inBig.filter((b) => b.view.match.ability).length, 1, '1 spy in 15p game');
  for (const b of inBig) await api(b, 'room/leave');
  for (const b of crowd) b.req.destroy();
  console.log('  ✓ 15-player cap, concurrent join race, abilities at scale');

  // ---------- main 5-player game ----------
  const names = ['Fahad', 'Ahmed', 'Khaled', 'Salem', 'Abdullah', 'Intruder'];
  const bots = [];
  for (let i = 0; i < names.length; i++) bots.push(await mkBot(names[i], CH[i]));
  const [fahad, ahmed, khaled, salem, abd, intruder] = bots;
  const players = bots.slice(0, 5);
  const c = await api(fahad, 'room/create', { roomName: 'Island', settings: { MIN_PLAYERS: 4, MAX_PLAYERS: 10 } });
  assert(c.ok, c.error);
  // character conflict on join
  await api(intruder, 'session/character', { characterId: CH[0] });
  const conflict = await api(intruder, 'room/join', { code: c.code });
  assert.strictEqual(conflict.code, 'CHARACTER_TAKEN');
  assert(conflict.taken.includes(CH[0]));
  await api(intruder, 'session/character', { characterId: CH[5] });
  assert((await api(intruder, 'room/join', { code: c.code })).ok);
  // kick
  assert.strictEqual((await api(ahmed, 'room/kick', { playerId: intruder.id })).code, 'NOT_IN_ROOM');
  assert((await api(ahmed, 'room/join', { code: c.code })).ok);
  const forb = await fetch(`${BASE}/api/room/kick`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ahmed.token}` }, body: JSON.stringify({ playerId: intruder.id }) });
  assert.strictEqual(forb.status, 403, 'non-host gets 403');
  assert.strictEqual((await forb.json()).code, 'FORBIDDEN');
  assert.strictEqual((await api(fahad, 'room/kick', { playerId: fahad.id })).code, 'INVALID_TARGET');
  assert((await api(fahad, 'room/kick', { playerId: intruder.id })).ok);
  await sleep(100);
  assert(intruder.events.some((e) => e.event === 'removed' && e.data.reason === 'KICKED'), 'kicked player notified in realtime');
  assert.strictEqual((await api(intruder, 'room/join', { code: c.code })).code, 'KICKED');
  const kev = await db.query("SELECT data FROM game_events WHERE type='PLAYER_KICKED'");
  assert.strictEqual(kev.rows[0].data.kickedPlayerId, intruder.id);
  // join lock
  assert((await api(fahad, 'room/join-open', { open: false })).ok);
  assert.strictEqual((await api(khaled, 'room/join', { code: c.code })).code, 'JOIN_CLOSED');
  assert((await api(fahad, 'room/join-open', { open: true })).ok);
  for (const b of [khaled, salem, abd]) assert((await api(b, 'room/join', { code: c.code.toLowerCase() })).ok);
  // realtime lobby update
  assert(fahad.events.filter((e) => e.event === 'sync').length > 3, 'host receives realtime lobby updates');
  assert((await api(fahad, 'room/start')).ok);
  assert.strictEqual((await api(fahad, 'room/settings', { settings: { VOTING_DURATION: 30 } })).code, 'LOCKED');

  await until(players, () => fahad.view.room.phase === 'ROUND_START' || fahad.view.room.phase === 'PRIVATE_CHAT');
  const owners = players.filter((b) => b.view.match.lastStand);
  assert.strictEqual(owners.length, 2);
  const holder = players.find((b) => b.view.match.ability);
  assert(holder && players.filter((b) => b.view.match.ability).length === 1);
  assert.strictEqual(players.filter((b) => b.events.some((e) => e.event === 'ability' && e.data.type === 'LAST_STAND')).length, 2);

  await until(players, () => fahad.view.room.phase === 'PRIVATE_CHAT');
  const before = players.map((b) => b.events.filter((e) => e.event === 'chat').length);
  assert((await api(fahad, 'chat/send', { to: ahmed.id, text: 'نتفق نصوت خالد؟' })).ok);
  assert((await api(ahmed, 'chat/send', { to: fahad.id, text: 'تم.' })).ok);
  assert((await api(ahmed, 'chat/send', { to: khaled.id, text: 'فهد ناوي يصوت عليك.' })).ok);
  assert.strictEqual((await api(salem, 'chat/send', { to: salem.id, text: 'x' })).code, 'INVALID_TARGET');
  assert.strictEqual((await api(salem, 'chat/send', { to: intruder.id, text: 'x' })).code, 'INVALID_TARGET');
  await sleep(150);
  const got = players.map((b, i) => b.events.filter((e) => e.event === 'chat').length - before[i]);
  assert.deepStrictEqual(got, [2, 3, 1, 0, 0], 'private messages delivered only to sender/receiver');
  assert.strictEqual((await api(salem, 'chat/history')).messages.length, 0);
  // idempotent send: same clientId twice → one message
  const cid = 'retry-test-0001';
  const m1 = await api(salem, 'chat/send', { to: abd.id, text: 'مرة وحدة', clientId: cid });
  const m2 = await api(salem, 'chat/send', { to: abd.id, text: 'مرة وحدة', clientId: cid });
  assert(m1.ok && m2.ok && m1.message.id === m2.message.id && m1.message.clientId === cid, 'retry is idempotent');
  assert.strictEqual((await api(salem, 'chat/history')).messages.length, 1);
  assert.strictEqual((await api(salem, 'chat/send', { to: 'not-a-uuid', text: 'x' })).code, 'INVALID_TARGET');
  assert.strictEqual((await api(ahmed, 'chat/history')).messages.length, 3);
  const otherView = JSON.stringify(salem.view);
  assert(!otherView.includes('نتفق'), 'no message content in views');

  await until(players, () => fahad.view.room.phase === 'ABILITY');
  assert.strictEqual((await api(fahad, 'chat/send', { to: ahmed.id, text: 'late' })).code, 'WRONG_PHASE');
  const pairs = holder.view.match.ability.options.pairs;
  const pick = pairs.find((p) => [p.a, p.b].sort().join() === [fahad.id, ahmed.id].sort().join()) || pairs[0];
  const syncBefore = players.map((b) => b.events.length);
  const spied = await api(holder, 'ability/use', { input: { a: pick.a, b: pick.b } });
  assert(spied.ok, spied.error);
  assert.strictEqual((await api(holder, 'ability/use', { input: pick })).code, 'NO_USES');
  await sleep(100);
  players.forEach((b, i) => b !== holder && assert.strictEqual(b.events.length, syncBefore[i], 'spy use invisible to others'));
  const nonHolder = players.find((b) => b !== holder);
  assert.strictEqual((await api(nonHolder, 'ability/use', { input: pick })).code, 'NO_ABILITY');

  // round 1: all vote owner o1; both owners use LAST STAND
  await until(players, () => fahad.view.room.phase === 'VOTING');
  const [o1, o2] = owners;
  for (const b of players) {
    const t = b === o1 ? players.find((x) => x !== o1).id : o1.id;
    const r = await api(b, 'vote', { targetId: t });
    assert(r.ok, r.error);
  }
  await until(players, () => fahad.view.room.phase === 'LAST_STAND');
  assert(players.every((b) => b.view.match.lastResult === null), 'result hidden during LAST STAND');
  assert.strictEqual((await api(players.find((b) => !owners.includes(b)), 'last-stand', { use: true })).code, 'NO_ABILITY');
  assert((await api(o1, 'last-stand', { use: true })).ok);
  assert((await api(o2, 'last-stand', { use: true })).ok);
  await until(players, () => fahad.view.room.phase === 'VOTE_RESULT');
  assert.strictEqual(fahad.view.match.lastResult.outcome, 'LAST_STAND_SAVED');
  assert.strictEqual(fahad.view.match.lastResult.savedId, o1.id);
  await until(players, () => fahad.view.match.round === 2);
  assert.strictEqual(fahad.view.match.aliveCount, 5);

  // round 2: Fahad (host) voted out → host migrates
  await until(players, () => fahad.view.room.phase === 'VOTING');
  for (const b of players) await api(b, 'vote', { targetId: b === fahad ? khaled.id : fahad.id });
  await until(players, () => fahad.view.room.phase === 'ELIMINATION');
  assert.strictEqual(fahad.view.match.myStatus, 'ELIMINATED');
  const newHost = fahad.view.room.hostId;
  assert(newHost !== fahad.id && fahad.view.match.players.find((p) => p.id === newHost).status === 'ALIVE', 'host migrated to an alive player');
  assert.strictEqual((await api(fahad, 'vote', { targetId: ahmed.id })).code, 'WRONG_PHASE');

  // reconnect: new "device" with same session token restores everything
  const salemPhone = { ...salem, events: [] };
  await listen(salemPhone);
  const res = await api(salemPhone, 'session/resume');
  assert(res.inRoom && res.user.characterId === CH[3]);
  await sync(salemPhone);
  assert.strictEqual(salemPhone.view.match.myStatus, 'ALIVE');

  // play to end: 2 survivors → both win, no voting at 2
  const alive = () => fahad.view.match.players.filter((p) => p.status === 'ALIVE').length;
  while (true) {
    await until(players, () => ['VOTING', 'GAME_OVER'].includes(fahad.view.room.phase), 15000);
    if (fahad.view.room.phase === 'GAME_OVER') break;
    assert(alive() > 2, 'no voting with 2 alive');
    for (const b of players) {
      const v = b.view.match.vote;
      if (v && v.candidates.length && !v.myVote) await api(b, 'vote', { targetId: v.candidates[0] });
    }
    await until(players, () => fahad.view.room.phase !== 'VOTING');
  }
  assert.strictEqual(fahad.view.match.winners.length, 2);
  console.log('  ✓ winners:', fahad.view.match.winners.map((w) => fahad.view.match.players.find((p) => p.id === w).name).join(' & '), '— rounds:', fahad.view.match.round);

  // persistence checks
  const counts = await db.query(`SELECT (SELECT count(*) FROM messages) m, (SELECT count(*) FROM votes) v, (SELECT count(*) FROM ability_uses) a, (SELECT count(*) FROM game_players) gp`);
  const row = counts.rows[0];
  assert.strictEqual(fahad.view.match.stats.find((x) => x.id === fahad.id).messagesSent, 1, 'messagesSent from DB');
  assert(Number(row.m) === 4 && Number(row.v) > 5 && Number(row.a) === 3 && Number(row.gp) === 20, JSON.stringify(row));

  // play again
  const host = players.find((b) => b.view.room.hostId === b.id);
  const others = players.filter((b) => b !== host);
  for (const b of others) assert.strictEqual((await api(b, 'match/again')).code, 'FORBIDDEN');
  assert((await api(host, 'match/again')).ok);
  await syncAll(players);
  assert(players.every((b) => b.view.match.round === 1 && b.view.match.intel.length === 0));
  assert.strictEqual((await api(ahmed, 'chat/history')).messages.length, 0);

  // ---------- HOST ADMIN (in-game) ----------
  await until(players, () => host.view.room.phase === 'PRIVATE_CHAT');
  // pause: timer frozen, gameplay actions blocked
  assert.strictEqual((await api(others[0], 'match/pause')).code, 'FORBIDDEN');
  assert((await api(host, 'match/pause')).ok);
  await sleep(1600); // > CHAT_DURATION
  await syncAll(players);
  assert(host.view.room.phase === 'PRIVATE_CHAT' && host.view.room.paused && host.view.room.phaseEndsAt === null, 'paused');
  assert.strictEqual((await api(others[0], 'chat/send', { to: others[1].id, text: 'x' })).code, 'PAUSED');
  assert((await api(host, 'match/resume')).ok);
  assert((await api(others[0], 'chat/send', { to: others[1].id, text: 'resumed' })).ok);
  // host technical status (no secrets) — only host sees lastSeenAgo
  assert(host.view.room.members.every((m) => typeof m.lastSeenAgo === 'number'));
  assert(others[0].view.room.members.every((m) => m.lastSeenAgo === undefined));
  // remove a player mid-game
  const victim = others[2];
  const evBefore = victim.events.length;
  assert((await api(host, 'room/kick', { playerId: victim.id })).ok);
  await sleep(100);
  assert(victim.events.slice(evBefore).some((e) => e.event === 'removed'), 'removed player notified');
  await syncAll(players);
  assert.strictEqual(victim.view, null);
  const vp = host.view.match.players.find((p) => p.id === victim.id);
  assert(vp.status === 'ELIMINATED' && vp.eliminatedReason === 'REMOVED' && vp.left);
  assert.strictEqual((await api(victim, 'room/join', { code: c.code })).code, 'KICKED');
  // end game: no winners, everyone notified
  const evCount = others[0].events.length;
  assert.strictEqual((await api(others[0], 'match/end')).code, 'FORBIDDEN');
  assert((await api(host, 'match/end')).ok);
  await sleep(100);
  assert(others[0].events.length > evCount, 'end game pushed in realtime');
  await syncAll(players.filter((b) => b !== victim));
  assert.strictEqual(host.view.room.phase, 'GAME_OVER');
  assert.strictEqual(host.view.match.endReason, 'HOST_ENDED');
  assert.strictEqual(host.view.match.winners.length, 0);
  // audit log
  const acts = (await db.query('SELECT action, host_id, target_player_id FROM host_actions ORDER BY id')).rows.map((r) => r.action);
  for (const a of ['HOST_KICKED_PLAYER', 'HOST_ENDED_GAME', 'HOST_CHANGED_SETTINGS', 'HOST_STARTED_GAME', 'HOST_CHANGED', 'HOST_PAUSED_GAME', 'HOST_RESUMED_GAME']) {
    assert(acts.includes(a), `audit ${a}`);
  }
  const kickRow = (await db.query("SELECT * FROM host_actions WHERE action='HOST_KICKED_PLAYER' AND target_player_id=$1", [victim.id])).rows[0];
  assert(kickRow && kickRow.host_id === host.id && kickRow.game_id);
  console.log('  ✓ host admin: 403, pause/resume, remove mid-game, END GAME (no winners), audit log');

  console.log('✅ all e2e checks passed');
  bots.forEach((b) => b.req.destroy());
  server.close();
  await db.close();
  process.exit(0);
})().catch(async (e) => {
  console.error('❌', e);
  process.exit(1);
});

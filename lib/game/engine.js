// ------------------------------------------------------------
// Game engine — كل قواعد اللعبة.
// تعمل على "مستند حالة" JSON يُحمّل من Postgres ويُقفل (FOR UPDATE)
// داخل Transaction، ثم يُحفظ. لا توجد مؤقتات في الذاكرة:
// الانتقال بين المراحل يتم عند أول طلب بعد phaseEndsAt (Lazy advance)
// باستخدام وقت الخادم فقط — مناسب لـServerless (Vercel).
// ------------------------------------------------------------
const crypto = require('crypto');
const baseConfig = require('../config');
const { GameError } = require('../errors');
const { getAbility, pickAbilityType } = require('./abilities');
const lastStandDef = require('./abilities/lastStand');
const { tally, topVoted, resolveTie, checkWin, randomItem } = require('./rules');
const { isValidCharacter } = require('../characters');

const uid = () => crypto.randomUUID();
const clone = (o) => JSON.parse(JSON.stringify(o));
const iso = (t) => new Date(t).toISOString();

const PHASE = {
  LOBBY: 'LOBBY',
  ROUND_START: 'ROUND_START',
  PRIVATE_CHAT: 'PRIVATE_CHAT',
  ABILITY: 'ABILITY',
  VOTING: 'VOTING',
  LAST_STAND: 'LAST_STAND',
  VOTE_RESULT: 'VOTE_RESULT',
  ELIMINATION: 'ELIMINATION',
  GAME_OVER: 'GAME_OVER',
};

function newRoomState({ id, code, host, now }) {
  const settings = clone(baseConfig);
  return {
    id,
    code,
    name: '',
    hostId: host.id,
    joinOpen: true,
    banned: [],
    settings,
    members: {},
    phase: PHASE.LOBBY,
    phaseEndsAt: null,
    phaseStartedAt: now,
    rev: 0,
    rate: {},
    match: null,
    closed: false,
    createdAt: now,
  };
}

// ctx: { now, sql:[] (queued inserts), notifyAll, notifyUsers:Set, events:[] , userRoom:[] }
function newCtx(now) {
  return { now, sql: [], notifyAll: false, notifyUsers: new Set(), events: [], dirty: false };
}

class Game {
  constructor(state, ctx) {
    this.S = state;
    this.ctx = ctx;
    this.clock = null; // وقت الانتقال المجدول أثناء اللحاق بالمراحل
  }

  // ================= infra =================
  get now() {
    return this.clock ?? this.ctx.now;
  }
  get settings() {
    return this.S.settings;
  }
  get match() {
    return this.S.match;
  }
  changed() {
    this.ctx.dirty = true;
  }
  notify() {
    this.ctx.dirty = true;
    this.ctx.notifyAll = true;
  }
  notifyUser(id) {
    this.ctx.dirty = true;
    this.ctx.notifyUsers.add(id);
  }
  emit(userIds, event, data) {
    this.ctx.events.push({ userIds, event, data });
  }
  sql(text, params) {
    this.ctx.sql.push([text, params]);
  }
  log(type, data = {}) {
    this.sql('INSERT INTO game_events (game_id, match_id, type, data, created_at) VALUES ($1,$2,$3,$4,$5)', [
      this.S.id,
      this.match ? this.match.id : null,
      type,
      JSON.stringify(data),
      iso(this.now),
    ]);
  }
  setUserRoom(userId, gameId) {
    if (gameId) this.sql('UPDATE users SET current_game_id=$2, updated_at=now() WHERE id=$1', [userId, gameId]);
    else this.sql('UPDATE users SET current_game_id=NULL, updated_at=now() WHERE id=$1 AND current_game_id=$2', [userId, this.S.id]);
  }

  // ================= helpers =================
  memberList() {
    return Object.values(this.S.members).sort((a, b) => a.joinedAt - b.joinedAt);
  }
  isHost(id) {
    return this.S.hostId === id;
  }
  requireHost(id) {
    if (!this.isHost(id)) throw new GameError('FORBIDDEN', 'هذا الإجراء للـHost فقط.');
  }
  requireActive() {
    if (this.S.paused) throw new GameError('PAUSED', 'اللعبة متوقفة مؤقتًا من الـHost.');
  }
  // سجل إجراءات الـHost (Audit trail)
  hostLog(action, hostId, targetId = null, extra = {}) {
    this.sql('INSERT INTO host_actions (game_id, host_id, action, target_player_id, created_at) VALUES ($1,$2,$3,$4,$5)', [
      this.S.id, hostId, action, targetId, iso(this.now),
    ]);
    this.log(action, { gameId: this.S.id, hostId, action, targetPlayerId: targetId, timestamp: iso(this.now), ...extra });
  }
  requireMember(id) {
    const m = this.S.members[id];
    if (!m) throw new GameError('NOT_IN_ROOM', 'أنت لست في هذه الغرفة.');
    return m;
  }
  requireMatch() {
    if (!this.match || this.S.phase === PHASE.LOBBY) throw new GameError('NO_MATCH', 'لا توجد مباراة قائمة.');
    return this.match;
  }
  requireAlive(id) {
    const m = this.requireMatch();
    const p = m.players[id];
    if (!p) throw new GameError('NOT_IN_MATCH', 'أنت لست ضمن هذه المباراة.');
    if (p.status !== 'ALIVE') throw new GameError('ELIMINATED', 'تم إقصاؤك ولا يمكنك التأثير على المباراة.');
    return p;
  }
  aliveIds() {
    const m = this.match;
    return m ? m.order.filter((id) => m.players[id].status === 'ALIVE') : [];
  }
  inMatch() {
    return !!this.match && this.S.phase !== PHASE.LOBBY && this.S.phase !== PHASE.GAME_OVER;
  }

  // ================= time & presence =================
  advance() {
    let guard = 0;
    while (this.S.phaseEndsAt && this.ctx.now >= this.S.phaseEndsAt && guard++ < 300) {
      this.clock = this.S.phaseEndsAt;
      this.onPhaseEnd();
    }
    this.clock = null;
    this.checkPresence();
  }

  onPhaseEnd() {
    switch (this.S.phase) {
      case PHASE.ROUND_START:
        return this.startChat();
      case PHASE.PRIVATE_CHAT:
        return this.startAbilityPhase();
      case PHASE.ABILITY:
        return this.startVoting(null);
      case PHASE.VOTING:
        return this.endVoting();
      case PHASE.LAST_STAND:
        return this.resolveLastStand();
      case PHASE.VOTE_RESULT:
        return this.match.revoteCandidates ? this.startVoting(this.match.revoteCandidates) : this.runElimination();
      case PHASE.ELIMINATION:
        return this.winCheck();
      default:
        this.S.phaseEndsAt = null;
    }
  }

  touch(userId) {
    const m = this.S.members[userId];
    if (!m) return;
    const was = m.connected;
    // لا نحفظ كل نبضة: فقط إذا مر وقت كافٍ أو تغيرت الحالة
    if (!was || this.ctx.now - m.lastSeen > 12_000) {
      m.lastSeen = this.ctx.now;
      this.changed();
    }
    if (!was) {
      m.connected = true;
      this.log('PLAYER_RECONNECTED', { playerId: userId });
      this.notify();
    }
  }

  checkPresence() {
    const s = this.settings;
    for (const m of this.memberList()) {
      const conn = this.ctx.now - m.lastSeen < s.PRESENCE_TIMEOUT_MS;
      if (conn !== m.connected) {
        m.connected = conn;
        this.log(conn ? 'PLAYER_RECONNECTED' : 'PLAYER_DISCONNECTED', { playerId: m.id });
        this.notify();
      }
    }
    if (this.S.phase === PHASE.LOBBY) {
      for (const m of this.memberList()) {
        if (!m.connected && this.ctx.now - m.lastSeen > s.LOBBY_DISCONNECT_TIMEOUT_MS) this.removeMember(m.id, 'TIMEOUT');
      }
    }
    // الـHost غير متصل؟ انقله لأول لاعب متصل مناسب
    const host = this.S.members[this.S.hostId];
    if (host && !host.connected) this.migrateHost('HOST_DISCONNECTED', true);
  }

  isAbandoned() {
    const ms = this.memberList();
    return !ms.length || ms.every((m) => this.ctx.now - m.lastSeen > this.settings.EMPTY_ROOM_TTL_MS);
  }

  // ================= lobby =================
  isCharacterFree(characterId, exceptId) {
    return !this.memberList().some((m) => m.characterId === characterId && m.id !== exceptId);
  }

  addMember(user) {
    if (this.S.members[user.id]) return this.S.members[user.id];
    if (this.S.banned.includes(user.id)) throw new GameError('KICKED', 'تمت إزالتك من هذه الغرفة بواسطة الـHost ولا يمكنك العودة إليها.');
    if (this.S.phase !== PHASE.LOBBY) throw new GameError('GAME_IN_PROGRESS', 'هذه المباراة بدأت بالفعل.');
    if (!this.S.joinOpen) throw new GameError('JOIN_CLOSED', 'الـHost أغلق الانضمام لهذه الغرفة حاليًا.');
    const count = this.memberList().length;
    const cap = Math.min(this.settings.MAX_PLAYERS, baseConfig.PLAYER_LIMIT);
    if (count >= cap) throw new GameError('ROOM_FULL', `الغرفة ممتلئة (${count} / ${cap}).`);
    if (!isValidCharacter(user.character_id)) throw new GameError('NO_CHARACTER', 'اختر شخصيتك أولًا.');
    const lower = user.name.toLowerCase();
    if (this.memberList().some((m) => m.name.toLowerCase() === lower)) {
      throw new GameError('NAME_TAKEN', 'يوجد لاعب بنفس الاسم في هذه الغرفة. غيّر اسمك ثم حاول مجددًا.');
    }
    if (!this.isCharacterFree(user.character_id)) {
      const err = new GameError('CHARACTER_TAKEN', 'شخصيتك مستخدمة في هذه الغرفة. اختر شخصية أخرى.');
      err.extra = { taken: this.memberList().map((m) => m.characterId) };
      throw err;
    }
    const m = { id: user.id, name: user.name, characterId: user.character_id, joinedAt: this.ctx.now, lastSeen: this.ctx.now, connected: true };
    this.S.members[user.id] = m;
    this.setUserRoom(user.id, this.S.id);
    this.log('PLAYER_JOINED', { playerId: user.id, name: user.name });
    this.notify();
    return m;
  }

  setCharacter(userId, characterId) {
    const m = this.requireMember(userId);
    if (this.S.phase !== PHASE.LOBBY) throw new GameError('LOCKED', 'لا يمكن تغيير الشخصية بعد بدء المباراة.');
    if (!isValidCharacter(characterId)) throw new GameError('INVALID_CHARACTER', 'شخصية غير موجودة.');
    if (!this.isCharacterFree(characterId, userId)) throw new GameError('CHARACTER_TAKEN', 'هذه الشخصية مختارة من لاعب آخر.');
    m.characterId = characterId;
    this.log('CHARACTER_SELECTED', { playerId: userId, characterId });
    this.notify();
  }

  applySettings(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new GameError('INVALID', 'إعدادات غير صالحة.');
    const allowed = this.settings.HOST_EDITABLE;
    const next = { ...this.settings };
    for (const [key, value] of Object.entries(patch)) {
      const rule = allowed[key];
      if (!rule) throw new GameError('INVALID', `لا يمكن تعديل ${key}.`);
      if (value === this.settings[key]) continue;
      if (typeof rule[0] === 'number') {
        const n = Math.round(Number(value));
        if (!Number.isFinite(n) || n < rule[0] || n > rule[1]) throw new GameError('INVALID', `${key} يجب أن يكون بين ${rule[0]} و ${rule[1]}.`);
        next[key] = n;
      } else {
        if (!rule.includes(value)) throw new GameError('INVALID', `قيمة غير مسموحة لـ ${key}.`);
        next[key] = value;
      }
    }
    const survivors = (next.WIN_CONDITION && next.WIN_CONDITION.survivors) || 1;
    if (next.MAX_PLAYERS > baseConfig.PLAYER_LIMIT) throw new GameError('INVALID', `الحد الأقصى ${baseConfig.PLAYER_LIMIT} لاعبًا.`);
    if (next.MIN_PLAYERS > next.MAX_PLAYERS) throw new GameError('INVALID', 'الحد الأدنى لا يمكن أن يكون أكبر من الحد الأقصى.');
    if (next.MIN_PLAYERS <= survivors) throw new GameError('INVALID', `الحد الأدنى يجب أن يكون أكبر من ${survivors}.`);
    if (next.MAX_PLAYERS < this.memberList().length) throw new GameError('INVALID', 'عدد اللاعبين الحالي أكبر من الحد الأقصى الجديد.');
    this.S.settings = next;
  }

  setRoomName(raw) {
    const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    if (name.length > this.settings.ROOM_NAME_MAX_LENGTH) throw new GameError('INVALID', `اسم الغرفة ${this.settings.ROOM_NAME_MAX_LENGTH} حرفًا كحد أقصى.`);
    if (/[<>{}\\]/.test(name)) throw new GameError('INVALID', 'اسم الغرفة يحتوي على رموز غير مسموحة.');
    this.S.name = name;
  }

  requireLobbyHost(userId) {
    this.requireHost(userId);
    if (this.S.phase !== PHASE.LOBBY) throw new GameError('LOCKED', 'الإعدادات مقفلة بعد بدء المباراة.');
  }

  updateSettings(userId, patch, roomName) {
    this.requireLobbyHost(userId);
    if (patch) this.applySettings(patch);
    if (roomName !== undefined) this.setRoomName(roomName);
    this.hostLog('HOST_CHANGED_SETTINGS', userId, null, { patch: patch || null, roomName: roomName ?? null });
    this.notify();
  }

  setJoinOpen(userId, open) {
    this.requireLobbyHost(userId);
    this.S.joinOpen = !!open;
    this.hostLog('HOST_CHANGED_SETTINGS', userId, null, { joinOpen: !!open });
    this.notify();
  }

  kick(userId, targetId) {
    this.requireHost(userId);
    if (this.S.phase !== PHASE.LOBBY) throw new GameError('LOCKED', 'لا يمكن طرد اللاعبين بعد بدء المباراة.');
    if (typeof targetId !== 'string' || !this.S.members[targetId]) throw new GameError('INVALID_TARGET', 'اللاعب غير موجود في الغرفة.');
    if (targetId === userId) throw new GameError('INVALID_TARGET', 'لا يمكنك طرد نفسك.');
    this.S.banned.push(targetId);
    delete this.S.members[targetId];
    delete this.S.rate[targetId];
    this.setUserRoom(targetId, null);
    this.log('PLAYER_KICKED', { gameId: this.S.id, hostPlayerId: userId, kickedPlayerId: targetId, timestamp: iso(this.ctx.now) });
    this.hostLog('HOST_KICKED_PLAYER', userId, targetId, { phase: 'LOBBY' });
    this.emit([targetId], 'removed', { reason: 'KICKED' });
    this.notify();
  }

  canStart() {
    const count = this.memberList().length;
    return count >= this.settings.MIN_PLAYERS && count <= Math.min(this.settings.MAX_PLAYERS, baseConfig.PLAYER_LIMIT) && this.memberList().every((m) => m.characterId);
  }

  // ================= match lifecycle =================
  startMatch(userId) {
    this.requireHost(userId);
    if (this.S.phase !== PHASE.LOBBY && this.S.phase !== PHASE.GAME_OVER) throw new GameError('LOCKED', 'المباراة قائمة بالفعل.');
    const members = this.memberList();
    if (members.length < this.settings.MIN_PLAYERS) throw new GameError('NOT_ENOUGH', `تحتاج ${this.settings.MIN_PLAYERS} لاعبين على الأقل.`);
    if (members.length > Math.min(this.settings.MAX_PLAYERS, baseConfig.PLAYER_LIMIT)) throw new GameError('TOO_MANY', 'عدد اللاعبين أكبر من الحد المسموح.');
    const players = {};
    const stats = {};
    for (const m of members) {
      players[m.id] = { id: m.id, name: m.name, characterId: m.characterId, status: 'ALIVE', eliminatedRound: null, eliminatedReason: null };
      stats[m.id] = { messagesSent: 0, votesCast: 0, votesReceived: 0, abilitiesUsed: 0 };
    }
    // Game State جديدة بالكامل — لا تنتقل أي أسرار
    this.S.match = {
      id: uid(),
      round: 0,
      order: members.map((m) => m.id),
      players,
      stats,
      votes: null,
      voteAttempt: 0,
      voteCandidates: null,
      revoteCandidates: null,
      ability: null,
      intel: {},
      lastStand: {},
      pendingResult: null,
      lastResult: null,
      results: [],
      winners: [],
      endReason: null,
      startedAt: this.now,
      endedAt: null,
    };
    this.S.rate = {};
    for (const m of members) {
      this.sql(
        'INSERT INTO game_players (game_id, match_id, player_id, character_id, status, is_host, joined_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [this.S.id, this.match.id, m.id, m.characterId, 'ALIVE', this.isHost(m.id), iso(m.joinedAt)]
      );
    }
    this.log('GAME_STARTED', { players: this.match.order });
    this.hostLog('HOST_STARTED_GAME', userId);
    this.assignLastStand();
    this.startRound();
  }

  setPhase(phase, seconds) {
    this.S.paused = null;
    this.S.phase = phase;
    this.S.phaseStartedAt = this.now;
    this.S.phaseEndsAt = seconds > 0 ? this.now + seconds * 1000 : null;
    this.S.rev += 1;
    this.log('PHASE_CHANGED', { phase, round: this.match ? this.match.round : null });
    this.notify();
  }

  assignLastStand() {
    const m = this.match;
    if (!this.settings.LAST_STAND_ENABLED) return;
    const pool = this.aliveIds().slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (const id of pool.slice(0, Math.min(this.settings.LAST_STAND_OWNERS, pool.length))) {
      m.lastStand[id] = { used: false, usedRound: null, decision: null };
      this.sql('INSERT INTO abilities (match_id, round, holder_id, type) VALUES ($1,0,$2,$3)', [m.id, id, lastStandDef.type]);
      this.log('ABILITY_ASSIGNED', { round: 0, holderId: id, type: lastStandDef.type });
      this.emit([id], 'ability', { type: lastStandDef.type });
    }
  }

  startRound() {
    const m = this.match;
    const pre = checkWin(m, this.settings.WIN_CONDITION);
    if (pre.over) return this.endGame(pre.winners); // لا تصويت عند بقاء لاعبَين
    m.round += 1;
    m.voteAttempt = 0;
    m.voteCandidates = null;
    m.revoteCandidates = null;
    m.votes = null;
    m.lastResult = null;
    this.sql('INSERT INTO rounds (match_id, round, started_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [m.id, m.round, iso(this.now)]);
    this.assignAbility();
    this.log('ROUND_STARTED', { round: m.round, alive: this.aliveIds().length });
    this.setPhase(PHASE.ROUND_START, this.settings.ROUND_START_DURATION);
  }

  assignAbility() {
    const m = this.match;
    m.ability = null;
    if (!this.settings.SPY_ENABLED) return;
    const alive = this.aliveIds();
    const type = pickAbilityType(this.settings.ABILITY_POOL);
    if (!alive.length || !type) return;
    const def = getAbility(type);
    const holderId = alive[crypto.randomInt(alive.length)];
    m.ability = { round: m.round, type, holderId, usesLeft: def.usesPerRound };
    this.sql('INSERT INTO abilities (match_id, round, holder_id, type) VALUES ($1,$2,$3,$4)', [m.id, m.round, holderId, type]);
    this.log('ABILITY_ASSIGNED', { round: m.round, holderId, type });
    this.emit([holderId], 'ability', { type });
  }

  startChat() {
    this.setPhase(PHASE.PRIVATE_CHAT, this.settings.CHAT_DURATION);
  }

  startAbilityPhase() {
    if (!this.settings.SPY_ENABLED || this.settings.ABILITY_DURATION <= 0) return this.startVoting(null);
    this.setPhase(PHASE.ABILITY, this.settings.ABILITY_DURATION);
  }

  startVoting(candidates) {
    const m = this.match;
    m.voteAttempt += 1;
    m.voteCandidates = candidates;
    m.revoteCandidates = null;
    m.votes = {};
    this.setPhase(PHASE.VOTING, this.settings.VOTING_DURATION);
  }

  voteTargetsFor(userId) {
    const m = this.match;
    const pool = m.voteCandidates || this.aliveIds();
    return pool.filter((id) => m.players[id].status === 'ALIVE' && (this.settings.ALLOW_SELF_VOTE || id !== userId));
  }

  castVote(userId, targetId) {
    const m = this.requireMatch();
    if (this.S.phase !== PHASE.VOTING) throw new GameError('WRONG_PHASE', 'التصويت غير مفتوح الآن.');
    this.requireActive();
    this.requireAlive(userId);
    if (m.votes[userId]) throw new GameError('ALREADY_VOTED', 'صوتك مُسجّل ولا يمكن تغييره.');
    if (typeof targetId !== 'string' || !this.voteTargetsFor(userId).includes(targetId)) {
      throw new GameError('INVALID_TARGET', 'لا يمكنك التصويت لهذا اللاعب.');
    }
    m.votes[userId] = targetId;
    m.stats[userId].votesCast += 1;
    this.sql('INSERT INTO votes (id, game_id, match_id, round, attempt, voter_id, target_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
      uid(), this.S.id, m.id, m.round, m.voteAttempt, userId, targetId, iso(this.now),
    ]);
    this.log('VOTE_CAST', { round: m.round, attempt: m.voteAttempt, voterId: userId, targetId });
    if (this.aliveIds().every((id) => m.votes[id])) this.endVoting();
    else this.notify(); // يحدّث عدد المصوتين فقط
  }

  endVoting() {
    const m = this.match;
    const alive = this.aliveIds();
    const noVote = alive.filter((id) => !m.votes[id]); // NO_VOTE
    const counts = tally(m.votes);
    for (const [id, c] of counts) m.stats[id].votesReceived += c;
    const top = topVoted(counts);
    this.log('VOTING_ENDED', { round: m.round, attempt: m.voteAttempt, counts: Object.fromEntries(counts), noVote });
    const candidates = m.voteCandidates || alive;
    const talliedList = candidates.map((id) => ({ id, votes: counts.get(id) || 0 })).sort((a, b) => b.votes - a.votes);

    let eliminatedId = null;
    let outcome = 'ELIMINATED';
    if (top.length === 0) outcome = 'NO_VOTES';
    else if (top.length === 1) eliminatedId = top[0];
    else {
      const res = resolveTie(this.settings.TIE_RULE, top, { attempt: m.voteAttempt, maxRevotes: this.settings.MAX_REVOTES });
      if (res.action === 'REVOTE') {
        m.lastResult = { round: m.round, tally: talliedList, tie: true, tied: top, outcome: 'REVOTE', eliminatedId: null, savedId: null, noVoteCount: noVote.length };
        m.revoteCandidates = top;
        return this.setPhase(PHASE.VOTE_RESULT, this.settings.VOTE_RESULT_DURATION);
      }
      if (res.action === 'NONE') outcome = 'TIE_NO_ELIMINATION';
      else {
        eliminatedId = res.id;
        outcome = 'TIE_RANDOM';
      }
    }
    const result = { round: m.round, tally: talliedList, tie: top.length > 1, tied: top.length > 1 ? top : [], outcome, eliminatedId, savedId: null, noVoteCount: noVote.length };
    if (this.lastStandActive()) {
      // النتيجة محسوبة لكنها مخفية حتى تنتهي نافذة LAST STAND (نفس المدة دائمًا)
      m.pendingResult = result;
      for (const ls of Object.values(m.lastStand)) ls.decision = null;
      return this.setPhase(PHASE.LAST_STAND, this.settings.LAST_STAND_DURATION);
    }
    this.finalizeResult(result);
  }

  lastStandActive() {
    return this.settings.LAST_STAND_ENABLED && Object.keys(this.match.lastStand).length > 0 && this.settings.LAST_STAND_DURATION > 0;
  }

  decideLastStand(userId, use) {
    const m = this.requireMatch();
    if (this.S.phase !== PHASE.LAST_STAND) throw new GameError('WRONG_PHASE', 'لا يمكن اتخاذ القرار في هذه المرحلة.');
    this.requireActive();
    this.requireAlive(userId);
    const ls = m.lastStand[userId];
    if (!ls || ls.used) throw new GameError('NO_ABILITY', 'لا تملك LAST STAND.');
    if (ls.decision) throw new GameError('ALREADY_DECIDED', 'قرارك مسجل بالفعل.');
    ls.decision = use === true ? 'USE' : 'SKIP';
    this.log('LAST_STAND_DECISION', { userId, decision: ls.decision, round: m.round });
    this.notifyUser(userId);
  }

  resolveLastStand() {
    const m = this.match;
    const r = m.pendingResult;
    m.pendingResult = null;
    for (const [id, ls] of Object.entries(m.lastStand)) {
      if (ls.decision === 'USE' && !ls.used && m.players[id].status === 'ALIVE') {
        ls.used = true;
        ls.usedRound = m.round;
        m.stats[id].abilitiesUsed += 1;
        this.sql('INSERT INTO ability_uses (match_id, round, user_id, type, input, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [m.id, m.round, id, lastStandDef.type, null, iso(this.now)]);
        this.log('ABILITY_USED', { userId: id, type: lastStandDef.type, round: m.round, wasTarget: id === r.eliminatedId });
      }
      ls.decision = null;
    }
    const target = r.eliminatedId && m.lastStand[r.eliminatedId];
    if (target && target.usedRound === m.round) {
      r.savedId = r.eliminatedId;
      r.eliminatedId = null;
      r.outcome = 'LAST_STAND_SAVED';
      this.log('LAST_STAND_SAVED', { playerId: r.savedId, round: m.round });
    }
    this.finalizeResult(r);
  }

  finalizeResult(result) {
    const m = this.match;
    m.lastResult = result;
    m.results.push(result);
    this.setPhase(PHASE.VOTE_RESULT, this.settings.VOTE_RESULT_DURATION);
  }

  runElimination() {
    const id = this.match.lastResult && this.match.lastResult.eliminatedId;
    if (id) this.eliminate(id, 'VOTE');
    this.setPhase(PHASE.ELIMINATION, this.settings.ELIMINATION_DURATION);
  }

  eliminate(playerId, reason) {
    const m = this.match;
    const p = m.players[playerId];
    if (!p || p.status !== 'ALIVE') return;
    p.status = 'ELIMINATED';
    p.eliminatedRound = m.round;
    p.eliminatedReason = reason;
    if (m.ability && m.ability.holderId === playerId) m.ability.usesLeft = 0;
    this.sql('UPDATE game_players SET status=$3 WHERE match_id=$1 AND player_id=$2', [m.id, playerId, 'ELIMINATED']);
    this.log('PLAYER_ELIMINATED', { playerId, reason, round: m.round });
    if (this.isHost(playerId)) this.migrateHost('HOST_ELIMINATED');
    this.notify();
  }

  winCheck() {
    const m = this.match;
    this.log('ROUND_ENDED', { round: m.round });
    const res = checkWin(m, this.settings.WIN_CONDITION);
    if (res.over) return this.endGame(res.winners);
    if (m.round >= this.settings.MAX_ROUNDS) return this.endGame(this.aliveIds());
    this.startRound();
  }

  endGame(winners) {
    const m = this.match;
    m.endReason = 'WIN';
    m.winners = winners;
    m.endedAt = this.now;
    m.ability = null;
    m.pendingResult = null;
    this.log('GAME_ENDED', { winners, rounds: m.round });
    this.setPhase(PHASE.GAME_OVER, 0);
  }

  playAgain(userId) {
    this.requireHost(userId);
    if (this.S.phase !== PHASE.GAME_OVER) throw new GameError('WRONG_PHASE', 'المباراة لم تنتهِ بعد.');
    this.S.match = null;
    this.startMatch(userId);
  }

  returnToLobby(userId) {
    this.requireHost(userId);
    if (this.S.phase !== PHASE.GAME_OVER) throw new GameError('WRONG_PHASE', 'المباراة لم تنتهِ بعد.');
    this.hostLog('HOST_RETURNED_TO_LOBBY', userId);
    this.S.match = null;
    this.setPhase(PHASE.LOBBY, 0);
  }

  // ================= chat =================
  // الرسائل الخاصة لا تمر من هنا: لها مسار سريع مستقل في lib/chat.js
  // (استعلامان فقط، بدون قفل الغرفة). الإحصائية messagesSent تُحسب من جدول messages.

  // ================= abilities =================
  async useAbility(userId, input, repo) {
    const m = this.requireMatch();
    this.requireAlive(userId);
    this.requireActive();
    const ab = m.ability;
    if (!ab || ab.holderId !== userId || ab.round !== m.round) throw new GameError('NO_ABILITY', 'لا تملك قدرة في هذه الجولة.');
    const def = getAbility(ab.type);
    if (!def.allowedPhases.includes(this.S.phase)) throw new GameError('WRONG_PHASE', 'لا يمكن استخدام القدرة في هذه المرحلة.');
    if (ab.usesLeft <= 0) throw new GameError('NO_USES', 'استخدمت قدرتك بالفعل.');
    const actx = { game: this, match: m, userId, settings: this.settings, repo };
    def.validate(actx, input);
    const result = await def.execute(actx, input);
    ab.usesLeft -= 1;
    m.stats[userId].abilitiesUsed += 1;
    const intel = { round: m.round, type: ab.type, ...result };
    (m.intel[userId] = m.intel[userId] || []).push(intel);
    this.sql('INSERT INTO ability_uses (match_id, round, user_id, type, input, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [m.id, m.round, userId, ab.type, JSON.stringify(input), iso(this.now)]);
    this.log('ABILITY_USED', { userId, type: ab.type, input, round: m.round });
    this.notifyUser(userId); // لا أحد غيره يعلم
    return intel;
  }

  // ================= host admin (in-game) =================
  // الـHost = لاعب + مشرف الغرفة. هذه الإجراءات لا تكشف أي معلومة سرية.
  removePlayer(userId, targetId) {
    this.requireHost(userId);
    if (this.S.phase === PHASE.LOBBY) return this.kick(userId, targetId);
    if (typeof targetId !== 'string' || !this.S.members[targetId]) throw new GameError('INVALID_TARGET', 'اللاعب غير موجود في الغرفة.');
    if (targetId === userId) throw new GameError('INVALID_TARGET', 'لا يمكنك إزالة نفسك. استخدم الخروج.');
    this.S.banned.push(targetId);
    this.hostLog('HOST_KICKED_PLAYER', userId, targetId, { phase: this.S.phase });
    this.emit([targetId], 'removed', { reason: 'KICKED' });
    this.removeMember(targetId, 'REMOVED');
  }

  endByHost(userId) {
    this.requireHost(userId);
    if (!this.inMatch()) throw new GameError('WRONG_PHASE', 'لا توجد مباراة جارية.');
    const m = this.match;
    this.hostLog('HOST_ENDED_GAME', userId, null, { round: m.round });
    m.endReason = 'HOST_ENDED';
    m.winners = []; // لا فائزين عند الإنهاء اليدوي
    m.endedAt = this.now;
    m.ability = null;
    m.pendingResult = null;
    this.log('GAME_ENDED', { winners: [], rounds: m.round, reason: 'HOST_ENDED' });
    this.setPhase(PHASE.GAME_OVER, 0);
  }

  pause(userId) {
    this.requireHost(userId);
    if (!this.settings.HOST_PAUSE_ENABLED) throw new GameError('DISABLED', 'الإيقاف المؤقت غير مفعّل.');
    if (!this.inMatch() || this.S.paused || !this.S.phaseEndsAt) throw new GameError('WRONG_PHASE', 'لا يمكن الإيقاف الآن.');
    this.S.paused = { remaining: Math.max(1000, this.S.phaseEndsAt - this.ctx.now), at: this.ctx.now };
    this.S.phaseEndsAt = null;
    this.hostLog('HOST_PAUSED_GAME', userId);
    this.notify();
  }

  resume(userId) {
    this.requireHost(userId);
    if (!this.S.paused) throw new GameError('WRONG_PHASE', 'اللعبة ليست متوقفة.');
    const p = this.S.paused;
    this.S.phaseEndsAt = this.ctx.now + p.remaining;
    this.S.phaseStartedAt += this.ctx.now - p.at;
    this.S.paused = null;
    this.hostLog('HOST_RESUMED_GAME', userId);
    this.notify();
  }

  // ================= host & membership =================
  migrateHost(reason, silentIfNone = false) {
    const others = this.memberList().filter((x) => x.id !== this.S.hostId);
    const alive = (x) => !this.inMatch() || (this.match.players[x.id] || {}).status === 'ALIVE';
    const next = others.find((x) => x.connected && alive(x)) || (silentIfNone ? null : others.find((x) => x.connected) || others.find((x) => alive(x)));
    if (!next) return;
    const prev = this.S.hostId;
    this.S.hostId = next.id;
    this.hostLog('HOST_CHANGED', next.id, prev, { reason });
    this.emit([next.id], 'host', { hostId: next.id });
    this.notify();
  }

  removeMember(userId, reason = 'LEFT') {
    if (!this.S.members[userId]) return;
    if (this.inMatch()) this.eliminate(userId, reason);
    delete this.S.members[userId];
    this.setUserRoom(userId, null);
    this.log('PLAYER_LEFT', { playerId: userId, reason });
    if (this.isHost(userId)) this.migrateHost('HOST_LEFT');
    this.notify();
    if (!this.memberList().length) return this.destroy('EMPTY');
    if (this.inMatch()) {
      const res = checkWin(this.match, this.settings.WIN_CONDITION);
      if (res.over) return this.endGame(res.winners);
      if (this.S.phase === PHASE.VOTING && this.aliveIds().every((id) => this.match.votes[id])) this.endVoting();
    }
  }

  close(userId) {
    this.requireHost(userId);
    if (this.S.phase !== PHASE.LOBBY) throw new GameError('LOCKED', 'لا يمكن إلغاء الغرفة أثناء المباراة. استخدم END GAME أولًا.');
    this.hostLog('HOST_CLOSED_ROOM', userId);
    this.emit(Object.keys(this.S.members), 'removed', { reason: 'CLOSED' });
    this.destroy('HOST_CLOSED');
  }

  destroy(reason) {
    for (const id of Object.keys(this.S.members)) this.setUserRoom(id, null);
    this.S.closed = true;
    this.S.phaseEndsAt = null;
    this.log('ROOM_CLOSED', { reason });
    this.changed();
  }
}

module.exports = { Game, PHASE, newRoomState, newCtx, uid };

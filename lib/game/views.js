// ------------------------------------------------------------
// Views — طبقة الخصوصية. كل طلب /api/sync يعيد نسخة مبنية
// للاعب الطالب فقط. لا أصوات الآخرين، لا أصحاب القدرات،
// لا محادثات الآخرين، ولا أي حالة داخلية للخادم.
// ------------------------------------------------------------
const { getAbility } = require('./abilities');
const lastStandDef = require('./abilities/lastStand');

const PUBLIC_SETTINGS = [
  'MIN_PLAYERS', 'MAX_PLAYERS', 'PLAYER_LIMIT', 'CHAT_DURATION', 'ABILITY_DURATION', 'VOTING_DURATION', 'LAST_STAND_DURATION',
  'ROUND_START_DURATION', 'VOTE_RESULT_DURATION', 'ELIMINATION_DURATION',
  'TIE_RULE', 'ALLOW_SPECTATORS', 'ALLOW_SELF_VOTE', 'MESSAGE_MAX_LENGTH', 'CHAT_PHASES', 'REVEAL_VOTE_COUNTS',
  'SPY_ENABLED', 'LAST_STAND_ENABLED', 'HOST_PAUSE_ENABLED', 'LAST_STAND_OWNERS', 'WIN_CONDITION', 'ROOM_NAME_MAX_LENGTH', 'HOST_EDITABLE', 'HEARTBEAT_MS',
];

function buildView(game, userId) {
  const S = game.S;
  const s = S.settings;
  const settings = {};
  for (const k of PUBLIC_SETTINGS) settings[k] = s[k];
  const me = S.members[userId];
  const view = {
    serverTime: game.ctx.now,
    rev: S.rev,
    me: { id: userId, name: me ? me.name : null, characterId: me ? me.characterId : null, isHost: S.hostId === userId },
    room: {
      code: S.code,
      name: S.name,
      joinOpen: S.joinOpen,
      hostId: S.hostId,
      phase: S.phase,
      phaseStartedAt: S.phaseStartedAt,
      phaseEndsAt: S.phaseEndsAt,
      paused: !!S.paused,
      pausedRemaining: S.paused ? S.paused.remaining : null,
      settings,
      canStart: game.canStart(),
      full: game.memberList().length >= Math.min(s.MAX_PLAYERS, s.PLAYER_LIMIT),
      members: game.memberList().map((m) => ({
        id: m.id, name: m.name, characterId: m.characterId, connected: m.connected, isHost: m.id === S.hostId,
        // حالة تقنية للـHost فقط (لا أسرار لعب)
        ...(S.hostId === userId ? { lastSeenAgo: Math.max(0, Math.round((game.ctx.now - m.lastSeen) / 1000)) } : {}),
      })),
    },
    match: null,
  };

  const m = S.match;
  if (!m || S.phase === 'LOBBY') return view;

  const self = m.players[userId];
  const myStatus = self ? self.status : 'NOT_IN_MATCH';
  const eliminated = myStatus !== 'ALIVE';
  const gameOver = S.phase === 'GAME_OVER';
  const limited = eliminated && !s.ALLOW_SPECTATORS && !gameOver;

  const players = m.order.map((id) => {
    const p = m.players[id];
    const mem = S.members[id];
    return {
      id,
      name: p.name,
      characterId: p.characterId,
      status: p.status,
      eliminatedRound: p.eliminatedRound,
      eliminatedReason: p.eliminatedReason,
      connected: mem ? mem.connected : false,
      left: !mem,
      isHost: id === S.hostId,
    };
  });

  const mv = {
    id: m.id,
    round: m.round,
    myStatus,
    players,
    aliveCount: players.filter((p) => p.status === 'ALIVE').length,
    ability: null,
    lastStand: null,
    intel: m.intel[userId] || [],
    vote: null,
    lastResult: null,
    winners: [],
    endReason: m.endReason || null,
    stats: null,
  };

  if (limited) {
    mv.intel = [];
    view.room.phaseEndsAt = null;
    view.match = mv;
    return view;
  }

  const ab = m.ability;
  if (ab && ab.holderId === userId && !eliminated && ab.round === m.round) {
    const def = getAbility(ab.type);
    const canUse = def.allowedPhases.includes(S.phase) && ab.usesLeft > 0;
    mv.ability = {
      type: ab.type, name: def.name, icon: def.icon, description: def.description,
      usesLeft: ab.usesLeft, canUse,
      options: canUse ? def.getOptions({ match: m, userId, settings: s }) : null,
    };
  }

  const ls = m.lastStand[userId];
  if (ls && !eliminated) {
    mv.lastStand = {
      type: lastStandDef.type, name: lastStandDef.name, icon: lastStandDef.icon, description: lastStandDef.description,
      used: ls.used, usedRound: ls.usedRound,
      canDecide: S.phase === 'LAST_STAND' && !ls.used,
      decision: S.phase === 'LAST_STAND' ? ls.decision : null,
    };
  }

  if (S.phase === 'VOTING' && m.votes) {
    mv.vote = {
      attempt: m.voteAttempt,
      isRevote: !!m.voteCandidates,
      candidates: eliminated ? [] : game.voteTargetsFor(userId),
      myVote: m.votes[userId] || null,
      votedCount: Object.keys(m.votes).length,
      totalVoters: mv.aliveCount,
    };
  }

  if (m.lastResult && (S.phase === 'VOTE_RESULT' || S.phase === 'ELIMINATION')) {
    const r = m.lastResult;
    const revealName = s.REVEAL_ELIMINATED_PLAYER || !r.eliminatedId || r.eliminatedId === userId;
    mv.lastResult = {
      round: r.round,
      outcome: r.outcome,
      tie: r.tie,
      tied: r.tied,
      noVoteCount: r.noVoteCount,
      tally: s.REVEAL_VOTE_COUNTS ? r.tally : null,
      eliminatedId: revealName ? r.eliminatedId : null,
      someoneEliminated: !!r.eliminatedId,
      savedId: r.savedId && (s.LAST_STAND_REVEAL || r.savedId === userId) ? r.savedId : null,
      someoneSaved: !!r.savedId,
    };
  }

  if (gameOver) {
    mv.winners = m.winners;
    mv.stats = m.order.map((id) => ({ id, ...m.stats[id] }));
  }

  view.match = mv;
  return view;
}

module.exports = { buildView };

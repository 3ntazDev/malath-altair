// ------------------------------------------------------------
// Rules — قواعد التعادل وشروط الفوز (قابلة للتوسع)
// ------------------------------------------------------------
const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];

// votes: { voterId: targetId }
function tally(votes) {
  const counts = new Map();
  for (const target of Object.values(votes || {})) counts.set(target, (counts.get(target) || 0) + 1);
  return counts;
}

function topVoted(counts) {
  let max = 0;
  for (const c of counts.values()) max = Math.max(max, c);
  if (max === 0) return [];
  return [...counts.entries()].filter(([, c]) => c === max).map(([id]) => id);
}

// كل قاعدة تعادل ترجع: { action: 'ELIMINATE', id } | { action: 'NONE' } | { action: 'REVOTE', candidates }
const TIE_RULES = {
  RANDOM: (tied) => ({ action: 'ELIMINATE', id: randomItem(tied) }),
  NO_ELIMINATION: () => ({ action: 'NONE' }),
  REVOTE: (tied, { attempt, maxRevotes }) =>
    attempt <= maxRevotes ? { action: 'REVOTE', candidates: tied } : { action: 'ELIMINATE', id: randomItem(tied) },
};

function resolveTie(rule, tied, ctx) {
  const fn = TIE_RULES[rule] || TIE_RULES.RANDOM;
  return fn(tied, ctx);
}

// كل شرط فوز يرجع { over: boolean, winners: [ids] }
const WIN_CONDITIONS = {
  LAST_STANDING: (match, cfg) => {
    const alive = Object.values(match.players).filter((p) => p.status === 'ALIVE').map((p) => p.id);
    const survivors = Math.max(1, cfg.survivors || 1);
    return alive.length <= survivors ? { over: true, winners: alive } : { over: false, winners: [] };
  },
};

function checkWin(match, winCfg) {
  const fn = WIN_CONDITIONS[winCfg.type] || WIN_CONDITIONS.LAST_STANDING;
  return fn(match, winCfg);
}

module.exports = { tally, topVoted, resolveTie, checkWin, TIE_RULES, WIN_CONDITIONS, randomItem };

// 👁️ SPY — مشاهدة محادثة خاصة بين لاعبين آخرين بدون علمهما.
const { GameError } = require('../../errors');

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

module.exports = {
  type: 'SPY',
  name: 'الجاسوس',
  icon: '👁️',
  description: 'اختر محادثة خاصة بين لاعبين آخرين واقرأها كاملة. لن يعرف أحد أنك فعلت ذلك.',
  allowedPhases: ['ABILITY'],
  usesPerRound: 1,

  // كل الثنائيات بين اللاعبين الآخرين (حتى الفارغة) كي لا تكشف القائمة من تحدث مع من
  getOptions({ match, userId, settings }) {
    const eligible = match.order
      .map((id) => match.players[id])
      .filter((p) => p.id !== userId && (settings.SPY_ALLOW_ELIMINATED_TARGETS || p.status === 'ALIVE'));
    const pairs = [];
    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) pairs.push({ key: pairKey(eligible[i].id, eligible[j].id), a: eligible[i].id, b: eligible[j].id });
    }
    return { pairs };
  },

  validate(ctx, input) {
    const a = input && input.a;
    const b = input && input.b;
    if (typeof a !== 'string' || typeof b !== 'string' || a === b) throw new GameError('INVALID_TARGET', 'اختر محادثة صحيحة.');
    if (a === ctx.userId || b === ctx.userId) throw new GameError('INVALID_TARGET', 'لا يمكنك التجسس على محادثتك أنت.');
    if (!this.getOptions(ctx).pairs.some((p) => p.key === pairKey(a, b))) throw new GameError('INVALID_TARGET', 'هذه المحادثة غير متاحة للتجسس.');
  },

  async execute({ match, repo }, input) {
    const messages = await repo.pairMessages(match.id, input.a, input.b);
    return { a: input.a, b: input.b, messages };
  },
};

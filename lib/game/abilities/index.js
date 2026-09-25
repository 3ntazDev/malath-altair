// ------------------------------------------------------------
// Abilities Registry — نظام قدرات Modular
// لإضافة قدرة جديدة: أنشئ ملفًا بنفس واجهة spy.js ثم سجّله هنا
// وأضفه إلى ABILITY_POOL في config.js.
//
// واجهة القدرة:
//   type, name, icon, description
//   allowedPhases: [...]   usesPerRound: n
//   getOptions(ctx)        → خيارات تظهر لصاحب القدرة فقط
//   validate(ctx, input)   → يرمي GameError عند إدخال غير صالح
//   execute(ctx, input)    → نتيجة خاصة بصاحب القدرة فقط
//   ctx = { room, match, userId, settings }
// ------------------------------------------------------------
const spy = require('./spy');

const REGISTRY = new Map([[spy.type, spy]]);

function getAbility(type) {
  return REGISTRY.get(type) || null;
}

function pickAbilityType(pool, rng = Math.random) {
  const valid = pool.filter((p) => REGISTRY.has(p.type) && p.weight > 0);
  if (!valid.length) return null;
  const total = valid.reduce((s, p) => s + p.weight, 0);
  let r = rng() * total;
  for (const p of valid) {
    if ((r -= p.weight) < 0) return p.type;
  }
  return valid[valid.length - 1].type;
}

module.exports = { getAbility, pickAbilityType, REGISTRY };

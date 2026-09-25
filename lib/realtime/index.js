// ------------------------------------------------------------
// Realtime — كل لاعب له قناة خاصة واحدة: private-user-<id>
// الخادم وحده يقرر ماذا يُرسل لكل قناة، ولا توجد قناة مشتركة
// تحمل بيانات سرية. الأحداث:
//   sync      → "الحالة تغيرت، اطلب نسختك" (بدون بيانات سرية)
//   chat      → رسالة خاصة (تُرسل للمرسل والمستقبل فقط)
//   ability   → إشعار قدرة سرية (لصاحبها فقط)
//   removed   → طُردت / أُغلقت الغرفة
//
// Drivers:
//   pusher  → للإنتاج على Vercel (PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER)
//   sse     → للتشغيل المحلي فقط (npm run dev)
// ------------------------------------------------------------
const usePusher = !!(process.env.PUSHER_KEY && process.env.PUSHER_SECRET && process.env.PUSHER_APP_ID);
// على Vercel بدون Pusher: وضع احتياطي (تحديث سريع كل ثانيتين) بدل التعطل
const driver = usePusher ? require('./pusher') : process.env.VERCEL ? require('./none') : require('./sse');

if (!usePusher && process.env.VERCEL) {
  console.warn('[realtime] PUSHER_* env vars are missing — using polling fallback (slower).');
}

const channelFor = (userId) => `private-user-${userId}`;

module.exports = {
  name: driver.name,
  channelFor,
  publish: (userIds, event, data) => driver.publish(userIds, event, data || {}),
  clientConfig: () => driver.clientConfig(),
  authorize: driver.authorize,
  sse: driver.name === 'sse' ? driver : null,
  usePusher,
};

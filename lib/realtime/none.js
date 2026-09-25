// بدون Pusher على Vercel: لا نشر لحظي — المتصفح يستخدم التحديث السريع (Polling) تلقائيًا.
module.exports = {
  name: 'none',
  async publish() {},
  authorize() {
    throw new Error('realtime disabled');
  },
  clientConfig() {
    return { driver: 'none' };
  },
};

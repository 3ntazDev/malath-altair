const Pusher = require('pusher');

let client = null;
function get() {
  if (!client) {
    client = new Pusher({
      appId: process.env.PUSHER_APP_ID,
      key: process.env.PUSHER_KEY,
      secret: process.env.PUSHER_SECRET,
      cluster: process.env.PUSHER_CLUSTER || 'eu',
      useTLS: true,
    });
  }
  return client;
}

module.exports = {
  name: 'pusher',
  async publish(userIds, event, data) {
    const channels = [...new Set(userIds)].map((id) => `private-user-${id}`);
    // Pusher: حتى 100 قناة في الطلب الواحد
    for (let i = 0; i < channels.length; i += 100) {
      await get().trigger(channels.slice(i, i + 100), event, data);
    }
  },
  authorize(socketId, channel) {
    return get().authorizeChannel(socketId, channel);
  },
  clientConfig() {
    return { driver: 'pusher', key: process.env.PUSHER_KEY, cluster: process.env.PUSHER_CLUSTER || 'eu' };
  },
};

// Server-Sent Events — للتطوير المحلي فقط (عملية واحدة).
const clients = new Map(); // userId -> Set(res)

module.exports = {
  name: 'sse',
  attach(userId, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId).add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    res.on('close', () => {
      clearInterval(ping);
      const set = clients.get(userId);
      if (set) {
        set.delete(res);
        if (!set.size) clients.delete(userId);
      }
    });
  },
  async publish(userIds, event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const id of new Set(userIds)) {
      for (const res of clients.get(id) || []) res.write(payload);
    }
  },
  authorize() {
    throw new Error('not used with sse');
  },
  clientConfig() {
    return { driver: 'sse' };
  },
};

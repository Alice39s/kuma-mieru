const counts = new Map<string, number>();
const titles: Record<string, string> = {
  default: 'Kuma Mieru Global Network',
  secondary: 'Tokyo Network Status',
};
const epoch = Date.UTC(2026, 8, 8, 0, 0);
const monitorList = Array.from({ length: 12 }, (_, index) => ({
  id: index + 1,
  name: `Probe ${String(index + 1).padStart(2, '0')}`,
  type: 'ping',
  sendUrl: 0,
  tags: [
    {
      id: index + 1,
      monitor_id: index + 1,
      tag_id: 1,
      name: 'Region',
      value: index % 2 ? 'Tokyo' : 'Hong Kong',
      color: '#16a34a',
    },
  ],
}));
const heartbeatList = Object.fromEntries(
  monitorList.map(monitor => [
    monitor.id,
    Array.from({ length: 100 }, (_, index) => ({
      status: monitor.id === 3 ? 0 : monitor.id === 5 ? 3 : 1,
      time: new Date(epoch + index * 60000).toISOString().replace('T', ' ').replace('.000Z', ''),
      msg: '',
      ping: monitor.id === 3 ? null : 20 + ((index * monitor.id) % 60),
    })),
  ])
);
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 43880,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__counts') {
      if (request.method === 'DELETE') counts.clear();
      return Response.json(Object.fromEntries(counts));
    }
    counts.set(url.pathname, (counts.get(url.pathname) ?? 0) + 1);
    if (url.pathname === '/icon.png') return new Response(null, { status: 404 });
    await Bun.sleep(100);
    const pageId = url.pathname.split('/').at(-1) ?? 'default';
    if (pageId === 'failed') return new Response('Unavailable', { status: 503 });
    if (url.pathname.includes('/heartbeat/')) {
      return Response.json({
        heartbeatList,
        uptimeList: Object.fromEntries(
          monitorList.map(m => [`${m.id}_24`, m.id === 3 ? 0.94 : 0.9999])
        ),
      });
    }
    const data = {
      config: {
        slug: pageId,
        title: titles[pageId] ?? pageId,
        description: 'Availability and latency across our global monitoring network.',
        icon: '/icon.png',
        theme: 'light',
        published: true,
        showTags: true,
        customCSS: '',
        footerText: '',
        showPoweredBy: false,
        googleAnalyticsId: null,
        showCertificateExpiry: false,
      },
      publicGroupList: [{ id: 1, name: 'Global Network', weight: 1, monitorList }],
      maintenanceList: [],
      incidents: [
        {
          id: 1,
          style: 'info',
          title: 'Network update',
          content: 'All scheduled upgrades are complete.',
          pin: true,
          createdDate: '2026-09-08 00:00:00',
          lastUpdatedDate: null,
          active: true,
        },
      ],
    };
    if (url.pathname.startsWith('/api/status-page/')) return Response.json(data);
    return new Response(
      `<!doctype html><html><head><title>${data.config.title}</title><link rel="icon" href="/icon.png"></head><body><script id="preload-data" type="application/json">${JSON.stringify(data)}</script></body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  },
});
console.log(`Fixture listening on ${server.url}`);

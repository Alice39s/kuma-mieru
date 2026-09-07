import type { OpenGraphData } from '@/app/lib/open-graph';

const headlineStyle = {
  fontSize: 64,
  fontWeight: 700,
  lineHeight: 1.2,
  color: '#fafafa',
  maxHeight: 160,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  lineClamp: 2,
  textWrap: 'balance',
  textFit: 'shrink',
} as const;

export function OpenGraphImage({ data, logo }: { data: OpenGraphData; logo: string }) {
  const maxPing = Math.max(1, ...data.checks.map(check => check.ping ?? 0));
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#111314',
        padding: '46px 56px',
        fontFamily: 'Noto Sans CJK SC',
        color: '#fafafa',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 42,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* This image is rendered by Takumi, outside the browser image pipeline. */}
          {/* oxlint-disable-next-line nextjs/no-img-element */}
          <img src={logo} width={40} height={40} alt="" />
          <span style={{ fontSize: 25, fontWeight: 700 }}>Kuma Mieru</span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 21,
            color: data.color,
          }}
        >
          <div style={{ width: 10, height: 10, borderRadius: 5, background: data.color }} />
          <span>{data.status}</span>
        </div>
      </div>
      <div
        style={{ marginTop: 38, height: 218, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div style={headlineStyle}>{data.title}</div>
        <div
          style={{
            fontSize: 20,
            color: '#a1a1aa',
            lineHeight: 1.15,
            maxHeight: 46,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {data.isMonitor ? data.pageTitle : data.description}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 84, width: '100%' }}>
        {data.checks.map((check, index) => (
          <div
            key={index}
            style={{
              flex: 1,
              height: data.isMonitor
                ? Math.max(8, Math.round(((check.ping ?? 0) / maxPing) * 78))
                : 14,
              background:
                check.status === 1 ? '#34d399' : check.status === 0 ? '#fb7185' : '#fbbf24',
              borderRadius: '3px 3px 0 0',
              opacity: 0.85,
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          borderTop: '1px solid #3f4346',
          marginTop: 24,
          paddingTop: 24,
          gap: 36,
        }}
      >
        {data.metrics.map(metric => (
          <div
            key={metric.label}
            style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 8 }}
          >
            <span style={{ fontSize: 15, color: '#a1a1aa' }}>{metric.label}</span>
            <span
              style={{
                fontSize: 34,
                fontWeight: 600,
                color: '#fafafa',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {metric.value}
            </span>
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 'auto',
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 14,
          color: '#71717a',
        }}
      >
        <span>{data.isMonitor ? 'RECENT CHECKS' : 'SERVICE STATUS'}</span>
        <span>{data.pageId}</span>
      </div>
    </div>
  );
}

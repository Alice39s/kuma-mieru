interface MonitorDataPreloadProps {
  pageId: string;
}

/**
 * Injects <link rel="preload"> hints so the browser fetches
 * /api/monitor and /api/config in parallel with rendering, before
 * the client-side SWR hooks even mount.
 */
export function MonitorDataPreload({ pageId }: MonitorDataPreloadProps) {
  const encodedId = encodeURIComponent(pageId);
  return (
    <>
      <link
        rel="preload"
        as="fetch"
        href={`/api/monitor?pageId=${encodedId}`}
        crossOrigin="anonymous"
      />
      <link
        rel="preload"
        as="fetch"
        href={`/api/config?pageId=${encodedId}`}
        crossOrigin="anonymous"
      />
    </>
  );
}

'use client';

import { useTheme } from 'next-themes';
import { use, useId, useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/** Rendered in the browser only; the pre-rendered page keeps the diagram source until Mermaid loads. */
export function Mermaid({ chart }: { chart: string }) {
  const isHydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  if (!isHydrated) return <pre className="km-mermaid-source">{chart}</pre>;
  return <MermaidContent chart={chart} />;
}

type MermaidModule = typeof import('mermaid');
type RenderResult = Awaited<ReturnType<MermaidModule['default']['render']>>;

let mermaidModule: Promise<MermaidModule> | undefined;
const renders = new Map<string, Promise<RenderResult>>();

function loadMermaid(): Promise<MermaidModule> {
  mermaidModule ??= import('mermaid');
  return mermaidModule;
}

function MermaidContent({ chart }: { chart: string }) {
  const id = useId();
  const { resolvedTheme } = useTheme();
  const { default: mermaid } = use(loadMermaid());
  const theme = resolvedTheme === 'dark' ? 'dark' : 'neutral';
  const key = `${theme}:${chart}`;
  let render = renders.get(key);
  if (render === undefined) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      fontFamily: 'inherit',
      theme,
    });
    // Mermaid uses the id in CSS selectors, so it keeps only word characters of React's id.
    render = mermaid.render(`mermaid-${id.replace(/[^\w-]/g, '')}`, chart);
    renders.set(key, render);
  }
  const { svg } = use(render);
  return <div className="km-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}

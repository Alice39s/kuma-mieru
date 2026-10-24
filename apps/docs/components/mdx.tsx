import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { Cards } from 'fumadocs-ui/components/card';
import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock';
import { File, Files, Folder } from 'fumadocs-ui/components/files';
import { ImageZoom } from 'fumadocs-ui/components/image-zoom';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { TypeTable } from 'fumadocs-ui/components/type-table';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { ImageProps } from 'fumadocs-core/framework';
import type { MDXComponents } from 'mdx/types';
import type { ComponentProps } from 'react';
import { Callout } from './callout';
import { Card } from './card';
import { Mermaid } from './mermaid';
import { iconComponents } from '@/lib/icons';
import { routeHref } from '@/lib/shared';

const DefaultLink = defaultMdxComponents.a;

type PreProps = ComponentProps<'pre'> & { 'data-label'?: string };

/** A code block whose scroll region is named by `rehypeCodeLabels`. */
function LabelledPre({ 'data-label': label, children, ref: _ref, ...props }: PreProps) {
  if (label === undefined) throw new Error('A code block reached the page without a label.');
  return (
    <CodeBlock {...props} viewportProps={{ 'aria-label': label }}>
      <Pre>{children}</Pre>
    </CodeBlock>
  );
}

function imageSource(src: ComponentProps<'img'>['src']): ImageProps['src'] {
  if (src instanceof Blob)
    throw new Error('MDX images take a file path or an imported image, not a Blob.');
  return src;
}

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    ...iconComponents,
    a: ({ href, ...props }) => (
      <DefaultLink {...props} href={href === undefined ? href : routeHref(href)} />
    ),
    // Authored images reach this component as imported files; Fumadocs' image props describe both forms of `src`.
    img: ({ src, ...props }: ComponentProps<'img'>) => (
      <ImageZoom {...props} src={imageSource(src)} />
    ),
    pre: LabelledPre,
    Accordion,
    Accordions,
    Callout,
    Card,
    // design.md cards: 16px apart.
    Cards: props => <Cards {...props} className="gap-4" />,
    File,
    Files,
    Folder,
    Mermaid,
    Step,
    Steps,
    Tab,
    // Tabs form one card: the tab list and the panel share the surface instead of nesting a second card.
    Tabs: props => (
      <Tabs {...props} className="rounded-(--radius-card) bg-fd-card [&>[role=tablist]]:border-b" />
    ),
    TypeTable,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}

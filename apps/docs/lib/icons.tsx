import {
  BookOpen,
  CircleHelp,
  Code,
  Compass,
  Container,
  Cloud,
  Globe,
  Link,
  Palette,
  Rocket,
  Settings2,
  Tags,
  Terminal,
  Triangle,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The icons that `icon:` in frontmatter and meta.json may name, also available as MDX components such as
 * `<Card icon={<Rocket />} />`. A small map keeps the rest of lucide out of the bundle.
 */
export const iconComponents = {
  BookOpen,
  CircleHelp,
  Code,
  Compass,
  Container,
  Cloud,
  Globe,
  Link,
  Palette,
  Rocket,
  Settings2,
  Tags,
  Terminal,
  Triangle,
  Zap,
};

type IconName = keyof typeof iconComponents;

function isIconName(name: string): name is IconName {
  return Object.hasOwn(iconComponents, name);
}

export function resolveIcon(name: string | undefined): ReactNode {
  if (name === undefined) return undefined;
  if (!isIconName(name)) {
    throw new Error(`Unknown icon "${name}"; add it to apps/docs/lib/icons.tsx.`);
  }
  const Icon = iconComponents[name];
  return <Icon />;
}

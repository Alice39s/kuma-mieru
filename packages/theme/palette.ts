import { semanticColors } from '@heroui/theme';

type Scale = (typeof semanticColors)['dark']['primary'];

function base(scale: Scale | string, name: string): string {
  if (typeof scale === 'string') return scale;
  if (scale.DEFAULT === undefined) throw new Error(`HeroUI dark theme has no ${name} colour.`);
  return scale.DEFAULT;
}

const dark = semanticColors.dark;

/**
 * The dark HeroUI palette as plain colour values, for renderers that do not read CSS variables, such as the Open
 * Graph images of the docs.
 */
export const darkPalette = {
  background: base(dark.background, 'background'),
  foreground: base(dark.foreground, 'foreground'),
  muted: base(dark.default, 'default'),
  primary: base(dark.primary, 'primary'),
  success: base(dark.success, 'success'),
  warning: base(dark.warning, 'warning'),
  danger: base(dark.danger, 'danger'),
  divider: base(dark.divider, 'divider'),
};

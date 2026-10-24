import localFont from 'next/font/local';

/**
 * The dashboard's fonts: Noto Sans SC for Latin text with the system CJK fonts behind it, JetBrains Mono for code.
 * The Latin variable files come from Fontsource, so the build reads no font service.
 */
export const fontSans = localFont({
  src: '../node_modules/@fontsource-variable/noto-sans-sc/files/noto-sans-sc-latin-wght-normal.woff2',
  weight: '100 900',
  variable: '--font-noto-sans',
});

export const fontMono = localFont({
  src: '../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
  weight: '100 800',
  variable: '--font-jetbrains-mono',
  adjustFontFallback: false,
});

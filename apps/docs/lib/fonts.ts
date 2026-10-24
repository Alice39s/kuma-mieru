import { JetBrains_Mono as FontMono, Noto_Sans_SC as FontSans } from 'next/font/google';

/** The dashboard's fonts: Noto Sans SC for Latin text with the system CJK fonts behind it, JetBrains Mono for code. */
export const fontSans = FontSans({
  subsets: ['latin'],
  variable: '--font-noto-sans',
});

export const fontMono = FontMono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
});

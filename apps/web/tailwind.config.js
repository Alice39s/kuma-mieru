import { fileURLToPath } from 'node:url';
import hero from '@kuma-mieru/theme/hero';
import typography from '@tailwindcss/typography';

// HeroUI component styles live in the installed package, wherever the workspace linker puts it.
const heroThemeDist = fileURLToPath(new URL('.', import.meta.resolve('@heroui/theme')));

/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    `${heroThemeDist}**/*.{js,ts,jsx,tsx}`,
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
    },
  },
  darkMode: 'class',
  plugins: [hero, typography()],
};

export default config;

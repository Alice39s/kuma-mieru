import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Renderer } from 'takumi-js/node';

/** The family every preview image uses; Takumi ships no CJK glyphs, so Chinese titles need Noto Sans SC. */
export const ogFontFamily = 'Noto Sans SC Variable';

/** Registers every woff2 subset of the Fontsource package as one family, so each script finds its glyphs. */
async function registerNotoSansSC(renderer: Renderer): Promise<void> {
  // The bundler replaces `require.resolve` with a module id, so the font files are found from the package directory,
  // where `next build` runs and the workspace linker places the dependency.
  const dir = join(process.cwd(), 'node_modules', '@fontsource-variable', 'noto-sans-sc', 'files');
  const files = (await readdir(dir)).filter(file => file.endsWith('-wght-normal.woff2')).sort();
  if (files.length === 0) throw new Error(`No Noto Sans SC font files in ${dir}`);
  for (const [rank, file] of files.entries()) {
    await renderer.registerFont({
      name: `${ogFontFamily} ${rank}`,
      data: await readFile(join(dir, file)),
      subsetOf: ogFontFamily,
      subsetRank: rank,
    });
  }
}

let shared: Promise<Renderer> | undefined;

export function ogRenderer(): Promise<Renderer> {
  shared ??= (async () => {
    const renderer = new Renderer();
    await registerNotoSansSC(renderer);
    return renderer;
  })();
  return shared;
}

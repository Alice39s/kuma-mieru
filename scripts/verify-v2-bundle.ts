import { gzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { load } from 'cheerio';
import { z } from 'zod';

const maximumInitialJavaScriptGzipBytes = 220 * 1024;
const clientDirectory = resolve(process.cwd(), 'dist', 'v2', 'client');
const indexPath = resolve(clientDirectory, 'index.html');
const html = await readFile(indexPath, 'utf8');
const document = load(html);
const sources = document('script[type="module"][src]')
  .toArray()
  .map(element => document(element).attr('src'));
const initialSources = z.array(z.string().min(1)).min(1).parse(sources);

const assets = await Promise.all(
  initialSources.map(async source => {
    const relativePath = source.replace(/^\//u, '');
    if (relativePath.includes('..')) throw new Error(`Unsafe initial asset path: ${source}`);
    const content = await readFile(resolve(clientDirectory, relativePath));
    return {
      path: relativePath,
      bytes: content.byteLength,
      gzipBytes: gzipSync(content, { level: 9 }).byteLength,
    };
  })
);
const totalGzipBytes = assets.reduce((total, asset) => total + asset.gzipBytes, 0);
if (totalGzipBytes > maximumInitialJavaScriptGzipBytes) {
  throw new Error(
    `Public initial JavaScript is ${totalGzipBytes} gzip bytes; budget is ${maximumInitialJavaScriptGzipBytes}`
  );
}
if (assets.some(asset => asset.path.toLowerCase().includes('admin'))) {
  throw new Error('The public HTML eagerly references an Admin JavaScript chunk');
}

const report = {
  schemaVersion: 1,
  budget: { publicInitialJavaScriptGzipBytes: maximumInitialJavaScriptGzipBytes },
  result: { publicInitialJavaScriptGzipBytes: totalGzipBytes, assets },
};
await mkdir(resolve(process.cwd(), 'dist', 'v2'), { recursive: true });
await writeFile(
  resolve(process.cwd(), 'dist', 'v2', 'bundle-report.json'),
  `${JSON.stringify(report, null, 2)}\n`
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

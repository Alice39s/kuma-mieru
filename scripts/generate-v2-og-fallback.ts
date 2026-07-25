import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createOgFallbackPng } from '../src/server/og/fallback';

const output = resolve(process.cwd(), 'dist', 'v2', 'client', 'opengraph.png');
await mkdir(resolve(output, '..'), { recursive: true });
await writeFile(output, createOgFallbackPng());
process.stdout.write(`Generated ${output}\n`);

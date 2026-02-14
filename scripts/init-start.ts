#!/usr/bin/env bun

import { existsSync, mkdirSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import chalk from 'chalk';

/**
 * Init Next.js standalone
 *
 * Next.js standalone output will not automatically copy the public and .next/static folders,
 * so we need to manually copy them to the correct location to avoid 404 errors.
 *
 * Reference: https://nextjs.org/docs/app/api-reference/config/next-config-js/output#automatically-copying-traced-files
 */

const projectRoot = process.cwd();
const standaloneDir = join(projectRoot, '.next', 'standalone');

console.log(chalk.blue('🚀 Init Next.js standalone...'));

async function copyStaticFiles() {
  try {
    // Ensure standalone directory exists
    if (!existsSync(standaloneDir)) {
      console.log(chalk.yellow(`standalone directory does not exist: ${standaloneDir}`));
      console.log(chalk.yellow('Please run next build to generate standalone output'));
      process.exit(1);
    }

    // Copy .next/static to standalone/.next/static
    const staticSource = join(projectRoot, '.next', 'static');
    const staticTarget = join(standaloneDir, '.next', 'static');

    if (existsSync(staticSource)) {
      // Ensure target .next directory exists
      const targetNextDir = dirname(staticTarget);
      if (!existsSync(targetNextDir)) {
        mkdirSync(targetNextDir, { recursive: true });
      }

      console.log(chalk.green(`Copy static files: ${staticSource} -> ${staticTarget}`));
      await cp(staticSource, staticTarget, { recursive: true, force: true });
    } else {
      console.log(chalk.yellow(`Static file source directory does not exist: ${staticSource}`));
    }

    // Copy public to standalone/public
    const publicSource = join(projectRoot, 'public');
    const publicTarget = join(standaloneDir, 'public');

    if (existsSync(publicSource)) {
      console.log(chalk.green(`Copy public files: ${publicSource} -> ${publicTarget}`));
      await cp(publicSource, publicTarget, { recursive: true, force: true });
    } else {
      console.log(chalk.yellow(`Public file source directory does not exist: ${publicSource}`));
    }

    console.log(chalk.green('✅ Static files copied successfully!'));
  } catch (error) {
    console.error(chalk.red('❌ Error copying static files:'), error);
    process.exit(1);
  }
}

await copyStaticFiles();

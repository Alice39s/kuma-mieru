import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import { extractPreloadData } from '../utils/json-processor';
import { sanitizeJsonString } from '../utils/json-sanitizer';

import 'dotenv/config';

const siteMetaSchema = z.object({
  title: z.string().default('Kuma Mieru'),
  description: z.string().default('A beautiful and modern uptime monitoring dashboard'),
  icon: z.string().default('/icon.svg'),
});

const pageConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  siteMeta: siteMetaSchema,
});

const configSchema = z.object({
  baseUrl: z.string().url(),
  defaultPageId: z.string(),
  pages: z.array(pageConfigSchema),
  isPlaceholder: z.boolean().default(false),
  isEditThisPage: z.boolean().default(false),
  isShowStarButton: z.boolean().default(true),
});

function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
}

function getBooleanEnvVar(name: string, defaultValue = true): boolean {
  const value = process.env[name];
  if (value === undefined) return defaultValue;

  console.log(`[env] ${name}=${value} (type: ${typeof value})`);

  const lowercaseValue = value.toLowerCase();
  console.log(`[env] ${name} -> ${lowercaseValue}`);

  return lowercaseValue === 'true';
}

function getOptionalEnvVar(name: string, defaultValue: string | null = null): string | null {
  const value = process.env[name];
  return value !== undefined ? value : defaultValue;
}

async function fetchSiteMeta(baseUrl: string, pageId: string) {
  const customTitle = getOptionalEnvVar('FEATURE_TITLE');
  const customDescription = getOptionalEnvVar('FEATURE_DESCRIPTION');
  const customIcon = getOptionalEnvVar('FEATURE_ICON');

  console.log(`[env] [fetching meta for page: ${pageId}]`);
  console.log(`[env] - FEATURE_TITLE: ${customTitle || 'Not set'}`);
  console.log(`[env] - FEATURE_DESCRIPTION: ${customDescription || 'Not set'}`);
  console.log(`[env] - FEATURE_ICON: ${customIcon || 'Not set'}`);

  const hasAnyCustomValue = customTitle || customDescription || customIcon;

  const hasAllCustomValues = customTitle && customDescription && customIcon;

  if (hasAllCustomValues) {
    return siteMetaSchema.parse({
      title: customTitle,
      description: customDescription,
      icon: customIcon,
    });
  }

  try {
    console.log(`[env] [fetching from: ${baseUrl}/status/${pageId}]`);
    const response = await fetch(`${baseUrl}/status/${pageId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch site meta: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // 首先尝试从预加载数据获取
    const preloadScript = $('#preload-data').text();
    if (!preloadScript) {
      // 如果找不到预加载数据，尝试从HTML中获取
      const pageTitle = $('title').text() || undefined;
      const metaDescription = $('meta[name="description"]').attr('content') || undefined;
      const favicon = $('link[rel="icon"]').attr('href') || undefined;

      console.log(
        `[env] [found in HTML] title: ${pageTitle}, desc: ${metaDescription}, icon: ${favicon}`,
      );

      return siteMetaSchema.parse({
        title: customTitle || pageTitle,
        description: customDescription || metaDescription,
        icon: customIcon || favicon,
      });
    }

    const jsonStr = sanitizeJsonString(preloadScript);
    const preloadData = extractPreloadData(jsonStr);

    console.log(
      `[env] [found in preload] title: ${preloadData.config?.title}, desc: ${preloadData.config?.description}, icon: ${preloadData.config?.icon}`,
    );

    // 合并自定义值，自定义优先级 > API
    return siteMetaSchema.parse({
      title: customTitle || preloadData.config?.title || undefined,
      description: customDescription || preloadData.config?.description || undefined,
      icon: customIcon || preloadData.config?.icon || undefined,
    });
  } catch (error) {
    console.error(`Error fetching site meta for page ${pageId}:`, error);

    if (hasAnyCustomValue) {
      return siteMetaSchema.parse({
        title: customTitle || undefined,
        description: customDescription || undefined,
        icon: customIcon || undefined,
      });
    }

    return siteMetaSchema.parse({});
  }
}

async function generateConfig() {
  try {
    console.log('[env] [generate-config]');
    console.log('[env] [start]');

    for (const key in process.env) {
      if (key.startsWith('FEATURE_')) {
        console.log(`[env] - ${key}: ${process.env[key]}`);
      }
    }

    const baseUrl = getRequiredEnvVar('UPTIME_KUMA_BASE_URL');

    // 处理多页面ID配置
    // 格式：PAGE_IDS=default:Default Page,page1:Page One,page2:Page Two
    // 或者简单格式：PAGE_IDS=default,page1,page2
    const pageIdsStr = process.env.PAGE_IDS || process.env.PAGE_ID;

    if (!pageIdsStr) {
      throw new Error('Either PAGE_IDS or PAGE_ID environment variable is required');
    }

    // 解析页面配置
    const pageConfigs: { id: string; name?: string }[] = [];
    const pageIdEntries = pageIdsStr.split(',').map((entry) => entry.trim());

    // 确定默认页面ID（第一个页面或者通过PAGE_DEFAULT_ID指定）
    const defaultPageId = process.env.PAGE_DEFAULT_ID || pageIdEntries[0].split(':')[0];

    for (const entry of pageIdEntries) {
      if (entry.includes(':')) {
        const [id, name] = entry.split(':');
        pageConfigs.push({ id: id.trim(), name: name.trim() });
      } else {
        pageConfigs.push({ id: entry.trim() });
      }
    }

    // 获取并验证配置项
    try {
      new URL(baseUrl);
    } catch {
      throw new Error('UPTIME_KUMA_BASE_URL must be a valid URL');
    }

    const isEditThisPage = getBooleanEnvVar('FEATURE_EDIT_THIS_PAGE', false);
    const isShowStarButton = getBooleanEnvVar('FEATURE_SHOW_STAR_BUTTON', true);

    console.log(`[env] - isEditThisPage: ${isEditThisPage}`);
    console.log(`[env] - isShowStarButton: ${isShowStarButton}`);

    // 为每个页面获取站点元数据
    const pagesWithMeta = await Promise.all(
      pageConfigs.map(async (page) => {
        console.log(`[env] [processing page: ${page.id}]`);
        const siteMeta = await fetchSiteMeta(baseUrl, page.id);
        console.log(
          `[env] [meta for ${page.id}] title: ${siteMeta.title}, desc: ${siteMeta.description}, icon: ${siteMeta.icon}`,
        );
        return {
          ...page,
          siteMeta,
        };
      }),
    );

    const config = configSchema.parse({
      baseUrl,
      defaultPageId,
      pages: pagesWithMeta,
      isPlaceholder: false,
      isEditThisPage,
      isShowStarButton,
    });

    const configPath = path.join(process.cwd(), 'config', 'generated-config.json');

    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    console.log('✅ Configuration file generated successfully!');
    console.log(`[env] [generated-config.json] ${configPath}`);
    console.log(`[env] [config] ${JSON.stringify(config, null, 2)}`);
  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Error generating configuration file:', error.message);
    } else {
      console.error('❌ Unknown error generating configuration file');
    }
    process.exit(1);
  }
}

generateConfig().catch(console.error);

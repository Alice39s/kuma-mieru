import { z } from 'zod';
import generatedConfig from './generated-config.json';

// 验证生成的配置
const siteMetaSchema = z.object({
  title: z.string(),
  description: z.string(),
  icon: z.string(),
  iconCandidates: z.array(z.string()).min(1),
});

const configSchema = z.object({
  baseUrl: z.string().url(),
  pageId: z.string(),
  pageIds: z.array(z.string()).min(1),
  pages: z.array(
    z.object({
      id: z.string(),
      siteMeta: siteMetaSchema,
    })
  ),
  siteMeta: siteMetaSchema,
  isPlaceholder: z.boolean(),
  isEditThisPage: z.boolean(),
  isShowStarButton: z.boolean(),
});

// 确保配置符合schema
const config = configSchema.parse(generatedConfig);

// 仅包含运行时环境变量
const runtimeEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const runtimeEnv = runtimeEnvSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
});

// 完整环境配置
export const env = {
  // 从配置文件获取的数据
  config: {
    ...config,
  },

  // 运行时环境变量
  runtime: runtimeEnv,
};

// 导出类型
export type Env = typeof env;

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { generatedConfigSchema } from './schemas';

function loadGeneratedConfig() {
  const configPath = join(process.cwd(), 'config', 'generated-config.json');

  try {
    const raw = readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load generated config at ${configPath}: ${reason}`);
  }
}

// 确保配置符合schema
const config = generatedConfigSchema.parse(loadGeneratedConfig());

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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { object, optional, parse, picklist, safeParse, summarize } from 'valibot';
import { generatedConfigFileSchema } from './schemas';

function readGeneratedConfigFile(configPath: string): string {
  try {
    return readFileSync(configPath, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load generated config at ${configPath}: ${reason}`);
  }
}

function loadGeneratedConfig() {
  const configPath = join(process.cwd(), 'config', 'generated-config.json');
  const result = safeParse(generatedConfigFileSchema, readGeneratedConfigFile(configPath));

  if (!result.success) {
    throw new Error(
      `Failed to load generated config at ${configPath}: ${summarize(result.issues)}`
    );
  }

  return result.output;
}

// 确保配置符合schema
const config = loadGeneratedConfig();

// 仅包含运行时环境变量
const runtimeEnvSchema = object({
  NODE_ENV: optional(
    picklist(
      ['development', 'production', 'test'],
      'NODE_ENV must be "development", "production" or "test"'
    ),
    'development'
  ),
});

const runtimeEnv = parse(runtimeEnvSchema, {
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

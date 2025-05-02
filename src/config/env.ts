import { z } from 'zod';

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string(),
  
  // Twitter API
  TWITTER_API_KEY: z.string(),
  TWITTER_API_SECRET: z.string(),
  TWITTER_ACCESS_TOKEN: z.string(),
  TWITTER_ACCESS_SECRET: z.string(),
  
  // OpenAI API
  OPENAI_API_KEY: z.string(),
  
  // Notification Channels
  FEISHU_APP_ID: z.string().optional(),
  FEISHU_APP_SECRET: z.string().optional(),
  DINGTALK_APP_KEY: z.string().optional(),
  DINGTALK_APP_SECRET: z.string().optional(),
  WECHAT_APP_ID: z.string().optional(),
  WECHAT_APP_SECRET: z.string().optional(),
});

export const env = envSchema.parse(process.env);

declare global {
  namespace NodeJS {
    interface ProcessEnv extends z.infer<typeof envSchema> {}
  }
} 
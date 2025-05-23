import { z } from 'zod';

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().optional().default('postgres://postgres:postgres@localhost:5432/infotrack'),
  
  // NextAuth
  NEXTAUTH_SECRET: z.string().optional().default('infotrack-default-secret-please-change-in-production'),
  NEXTAUTH_URL: z.string().optional(),
  
  // Twitter API
  TWITTER_API_KEY: z.string().optional().default('dummy_twitter_api_key'),
  TWITTER_API_SECRET: z.string().optional().default('dummy_twitter_api_secret'),
  TWITTER_ACCESS_TOKEN: z.string().optional().default('dummy_twitter_access_token'),
  TWITTER_ACCESS_SECRET: z.string().optional().default('dummy_twitter_access_secret'),
  
  // OpenAI API
  OPENAI_API_KEY: z.string().optional().default('dummy_openai_api_key'),
  
  // 阿里大模型 API
  ALI_API_KEY: z.string().default('sk-48cac4f6e9ad4dabbcc0688654e70820'),
  
  // Notification Channels
  FEISHU_APP_ID: z.string().optional(),
  FEISHU_APP_SECRET: z.string().optional(),
  DINGTALK_APP_KEY: z.string().optional(),
  DINGTALK_APP_SECRET: z.string().optional(),
  WECHAT_APP_ID: z.string().optional(),
  WECHAT_APP_SECRET: z.string().optional(),
  
  // 百度智能外呼平台
  BAIDU_ACCESS_KEY: z.string().default('1c0dcd70ec4c4af1a4418c137e314abe'),
  BAIDU_SECRET_KEY: z.string().default('b53c0c34e7564cddb4169a35847ffcc6'),
  BAIDU_ROBOT_ID: z.string().default('6c428d95-790b-4ef4-8b1c-d6622520c8b6'),
  BAIDU_CALLER_NUMBER: z.string().default('02110001023'),
});

export const env = envSchema.parse(process.env);

declare global {
  namespace NodeJS {
    interface ProcessEnv extends z.infer<typeof envSchema> {}
  }
} 
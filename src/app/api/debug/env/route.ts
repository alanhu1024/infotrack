import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/config/env';

export async function GET(request: NextRequest) {
  // 获取Twitter API相关的环境变量
  const twitterEnv = {
    TWITTER_API_KEY: env.TWITTER_API_KEY || '未设置',
    TWITTER_API_SECRET: env.TWITTER_API_SECRET || '未设置',
    TWITTER_ACCESS_TOKEN: env.TWITTER_ACCESS_TOKEN || '未设置',
    TWITTER_ACCESS_SECRET: env.TWITTER_ACCESS_SECRET || '未设置',
  };

  // 对密钥进行部分隐藏处理，只显示前4个和后4个字符
  const maskedEnv = Object.entries(twitterEnv).reduce((acc, [key, value]) => {
    if (value && value !== '未设置' && value.length > 8) {
      const prefix = value.substring(0, 4);
      const suffix = value.substring(value.length - 4);
      acc[key] = `${prefix}...${suffix}`;
    } else {
      acc[key] = value;
    }
    return acc;
  }, {} as Record<string, string>);

  return NextResponse.json({
    message: '当前已读取的Twitter API环境变量',
    data: maskedEnv,
    timestamp: new Date().toISOString()
  });
} 
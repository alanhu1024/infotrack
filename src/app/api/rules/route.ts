import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { trackingService } from '@/services/tracking';
import { TwitterService, twitterServiceSingleton } from '@/services/twitter';
import { AIService } from '@/services/ai';
import { notificationServices } from '@/services/notification';
import { env } from '@/config/env';

const createRuleSchema = z.object({
  name: z.string().min(1, '规则名称不能为空'),
  description: z.string().optional(),
  twitterUsername: z.string().min(1, 'Twitter 用户名不能为空'),
  criteria: z.string().min(1, '筛选标准不能为空'),
  pollingInterval: z.number().min(60).max(86400), // 允许最大24小时
  notificationPhone: z.string().regex(/^1\d{10}$/, '手机号格式不正确').optional(),
});

// 硬编码大模型配置
const DEFAULT_LLM_PROVIDER = 'ali'; // 默认使用阿里模型
const DEFAULT_LLM_API_KEY = env.ALI_API_KEY; // 从环境变量中获取阿里API Key

export async function POST(request: Request) {
  try {
    // 获取当前用户会话
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: '未登录或会话已过期' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validatedData = createRuleSchema.parse(body);

    // 创建规则，包含 Twitter 用户名
    const rule = await prisma.trackingRule.create({
      data: {
        name: validatedData.name,
        description: validatedData.description || '',
        criteria: validatedData.criteria,
        twitterUsername: validatedData.twitterUsername,
        userId: session.user.id,
        isActive: true,
        pollingEnabled: true,
        pollingInterval: validatedData.pollingInterval,
        notificationPhone: validatedData.notificationPhone,
        llmProvider: DEFAULT_LLM_PROVIDER,
        llmApiKey: DEFAULT_LLM_API_KEY,
      },
    });

    // 使用trackingService单例启动轮询
    await trackingService.startTracking(rule);

    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    console.error('Error creating rule:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: '输入验证失败', details: error.errors },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: '创建规则失败' },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: '未登录或会话已过期' },
        { status: 401 }
      );
    }

    const rules = await prisma.trackingRule.findMany({
      where: {
        userId: session.user.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json(rules);
  } catch (error) {
    console.error('Error fetching rules:', error);
    return NextResponse.json(
      { error: '获取规则列表失败' },
      { status: 500 }
    );
  }
} 
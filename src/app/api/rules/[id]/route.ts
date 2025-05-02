import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const updateRuleSchema = z.object({
  name: z.string().min(1, '规则名称不能为空'),
  description: z.string().optional(),
  twitterUsername: z.string().min(1, 'Twitter 用户名不能为空'),
  criteria: z.string().min(1, '筛选标准不能为空'),
  isActive: z.boolean(),
  pollingInterval: z.number().min(60).max(3600),
});

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: '未登录或会话已过期' },
        { status: 401 }
      );
    }

    const rule = await prisma.trackingRule.findUnique({
      where: { id: params.id },
    });

    if (!rule) {
      return NextResponse.json(
        { error: '规则不存在' },
        { status: 404 }
      );
    }

    if (rule.userId !== session.user.id) {
      return NextResponse.json(
        { error: '无权修改此规则' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validatedData = updateRuleSchema.parse(body);

    // 只更新规则本身
    const updatedRule = await prisma.trackingRule.update({
      where: { id: params.id },
      data: {
        name: validatedData.name,
        description: validatedData.description || '',
        criteria: validatedData.criteria,
        isActive: validatedData.isActive,
        twitterUsername: validatedData.twitterUsername,
        pollingInterval: validatedData.pollingInterval,
      },
    });

    return NextResponse.json(updatedRule);
  } catch (error) {
    console.error('Error updating rule:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: '输入验证失败', details: error.errors },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: '更新规则失败' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: '未登录或会话已过期' },
        { status: 401 }
      );
    }

    const rule = await prisma.trackingRule.findUnique({
      where: { id: params.id },
    });

    if (!rule) {
      return NextResponse.json(
        { error: '规则不存在' },
        { status: 404 }
      );
    }

    if (rule.userId !== session.user.id) {
      return NextResponse.json(
        { error: '无权删除此规则' },
        { status: 403 }
      );
    }

    // 删除规则及相关数据
    await prisma.$transaction([
      // 删除相关的通知
      prisma.notification.deleteMany({
        where: {
          tweet: {
            matchedRuleId: params.id,
          },
        },
      }),
      // 删除相关的推文分析
      prisma.tweetAnalysis.deleteMany({
        where: {
          tweet: {
            matchedRuleId: params.id,
          },
        },
      }),
      // 删除相关的推文
      prisma.tweet.deleteMany({
        where: {
          matchedRuleId: params.id,
        },
      }),
      // 删除规则
      prisma.trackingRule.delete({
        where: { id: params.id },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting rule:', error);
    return NextResponse.json(
      { error: '删除规则失败' },
      { status: 500 }
    );
  }
} 
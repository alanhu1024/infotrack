import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { trackingService } from '@/services/tracking';
import { twitterServiceSingleton } from '@/services/twitter';
import { AIService } from '@/services/ai';

const updateRuleSchema = z.object({
  name: z.string().min(1, '规则名称不能为空'),
  description: z.string().optional(),
  twitterUsername: z.string().min(1, 'Twitter 用户名不能为空'),
  criteria: z.string().min(1, '筛选标准不能为空'),
  isActive: z.boolean(),
  pollingInterval: z.number().min(60).max(3600),
  llmProvider: z.string().min(1, '大模型类型不能为空'),
  llmApiKey: z.string().optional(),
});

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const data = await request.json();
    const { timeSlots, ...ruleData } = updateRuleSchema.parse(data);

    // 更新规则基本信息
    const rule = await prisma.trackingRule.update({
      where: {
        id: params.id,
        userId: session.user.id,
      },
      data: ruleData,
    });

    // 删除现有的时间段
    await prisma.trackingTimeSlot.deleteMany({
      where: {
        ruleId: params.id,
      },
    });

    // 创建新的时间段
    if (timeSlots && timeSlots.length > 0) {
      await prisma.trackingTimeSlot.createMany({
        data: timeSlots.map((slot: any) => ({
          ruleId: params.id,
          startTime: slot.startTime,
          endTime: slot.endTime,
          pollingInterval: slot.pollingInterval,
        })),
      });
    }

    return NextResponse.json(rule);
  } catch (error) {
    console.error('更新规则失败:', error);
    return NextResponse.json(
      { error: '更新规则失败' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ success: false, message: '未授权' }, { status: 401 });
  }

  try {
    const id = params.id;
    
    // 获取规则
    const rule = await prisma.trackingRule.findUnique({
      where: { id }
    });
    
    if (!rule) {
      return NextResponse.json({ success: false, message: '规则不存在' }, { status: 404 });
    }
    
    // 确保用户只能管理自己的规则
    if (rule.userId !== session.user.id) {
      return NextResponse.json({ success: false, message: '无权限' }, { status: 403 });
    }
    
    // 停止追踪
    await trackingService.stopTracking(rule);
    
    // 删除规则和相关数据
    await trackingService.deleteRule(id);
    
    return NextResponse.json({ success: true, message: '规则已删除' });
  } catch (error) {
    console.error('删除规则失败:', error);
    return NextResponse.json(
      { success: false, message: '删除规则失败', error: String(error) },
      { status: 500 }
    );
  }
} 
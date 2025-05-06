import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { trackingService } from '@/services/tracking';
import { twitterServiceSingleton } from '@/services/twitter';
import { AIService } from '@/services/ai';
import { notificationServices } from '@/services/notification';
import { BaiduCallingService } from '@/services/notification/baidu-calling';

const updateRuleSchema = z.object({
  name: z.string().min(1, '规则名称不能为空'),
  description: z.string().optional(),
  twitterUsername: z.string().min(1, 'Twitter 用户名不能为空'),
  criteria: z.string().min(1, '筛选标准不能为空'),
  isActive: z.boolean(),
  pollingInterval: z.number().min(60).max(86400),
  notificationPhone: z.string().regex(/^1\d{10}$/, '手机号格式不正确').optional(),
  timeSlots: z.array(z.any()).optional(),
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

    // 获取现有规则，保留大模型配置
    const existingRule = await prisma.trackingRule.findUnique({
      where: {
        id: params.id,
        userId: session.user.id,
      },
      select: {
        llmProvider: true,
        llmApiKey: true,
        notificationPhone: true,
      },
    });

    if (!existingRule) {
      return NextResponse.json({ error: '规则不存在' }, { status: 404 });
    }

    // 更新规则基本信息，保持大模型配置不变
    const rule = await prisma.trackingRule.update({
      where: {
        id: params.id,
        userId: session.user.id,
      },
      data: {
        ...ruleData,
        llmProvider: existingRule.llmProvider,
        llmApiKey: existingRule.llmApiKey,
      },
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

    // 如果更新了通知手机号码，并且与之前不同，将其添加到百度智能外呼平台白名单
    if (ruleData.notificationPhone && ruleData.notificationPhone !== existingRule.notificationPhone) {
      try {
        console.log(`[API/rules/update] 将手机号码 ${ruleData.notificationPhone} 添加到百度智能外呼平台白名单`);
        const baiduCallingService = notificationServices.get('baidu-calling') as BaiduCallingService | undefined;
        
        if (baiduCallingService) {
          const importResult = await baiduCallingService.ensurePhoneInWhitelist([ruleData.notificationPhone]);
          console.log(`[API/rules/update] 导入白名单结果: ${importResult.message}`);
        } else {
          console.warn('[API/rules/update] 百度智能外呼服务未配置，无法添加手机号码到白名单');
        }
      } catch (error) {
        console.error('[API/rules/update] 添加手机号码到白名单失败:', error);
        // 继续更新规则，不因白名单导入失败而中断更新过程
      }
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
    await trackingService.stopTracking(rule.id, rule.name);
    
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
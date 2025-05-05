import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { SubscriptionService } from '@/services/subscription';
import { authOptions } from '@/lib/auth';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const subscriptionService = new SubscriptionService();

// 获取当前用户订阅信息
export async function GET() {
  const session = await getServerSession(authOptions);
  
  if (!session?.user) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const userId = (session.user as any).id;
    
    if (!userId) {
      return NextResponse.json({ error: '无法识别用户' }, { status: 400 });
    }
    
    const subscriptionInfo = await subscriptionService.getUserSubscription(userId);
    const usage = await subscriptionService.getCurrentMonthUsage(userId);
    
    return NextResponse.json({
      subscription: subscriptionInfo,
      usage: {
        rulesUsed: usage.usage.rulesUsed,
        notificationsUsed: usage.usage.notificationsUsed,
        remainingRules: usage.remainingRules,
        remainingNotifications: usage.remainingNotifications,
      }
    });
  } catch (error) {
    console.error('获取订阅信息失败:', error);
    return NextResponse.json({ error: '获取订阅信息失败' }, { status: 500 });
  }
}

// 更新用户订阅
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const userId = (session.user as any).id;
    
    if (!userId) {
      return NextResponse.json({ error: '无法识别用户' }, { status: 400 });
    }
    
    const { plan, paymentType, paymentId } = await request.json();
    
    // 验证输入
    if (!plan || !['FREE', 'BASIC', 'PRO', 'PREMIUM'].includes(plan)) {
      return NextResponse.json({ error: '无效的订阅计划' }, { status: 400 });
    }
    
    if (paymentType !== 'monthly' && paymentType !== 'annually') {
      return NextResponse.json({ error: '无效的支付类型' }, { status: 400 });
    }
    
    // 这里应该有支付处理逻辑，但为简单起见省略
    
    // 更新订阅
    const updatedSubscription = await subscriptionService.changePlan(
      userId,
      plan as any,  // 类型转换为SubscriptionPlan
      paymentType,
      paymentId
    );
    
    return NextResponse.json({ subscription: updatedSubscription });
  } catch (error) {
    console.error('更新订阅失败:', error);
    return NextResponse.json({ error: '更新订阅失败' }, { status: 500 });
  }
} 
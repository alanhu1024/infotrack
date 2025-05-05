import { PrismaClient } from '@prisma/client';
import { startOfMonth, endOfMonth } from 'date-fns';

const prisma = new PrismaClient();

// 定义订阅计划类型
type SubscriptionPlan = 'FREE' | 'BASIC' | 'PRO' | 'PREMIUM';

export interface SubscriptionQuotas {
  monthlyRuleQuota: number;
  monthlyNotifyQuota: number;
}

// 各套餐的配额设置
const planQuotas: Record<SubscriptionPlan, SubscriptionQuotas> = {
  FREE: {
    monthlyRuleQuota: 1,
    monthlyNotifyQuota: 10,
  },
  BASIC: {
    monthlyRuleQuota: 5,
    monthlyNotifyQuota: 200,
  },
  PRO: {
    monthlyRuleQuota: 20,
    monthlyNotifyQuota: 1000,
  },
  PREMIUM: {
    monthlyRuleQuota: 999, // 无限设为一个很大的值
    monthlyNotifyQuota: 5000,
  },
};

// 套餐价格（单位：元）
export const planPrices = {
  FREE: { monthly: 0, annually: 0 },
  BASIC: { monthly: 39, annually: 399 },
  PRO: { monthly: 99, annually: 999 },
  PREMIUM: { monthly: 299, annually: 2999 },
};

export class SubscriptionService {
  // 获取用户当前订阅
  async getUserSubscription(userId: string) {
    if (!userId) {
      throw new Error('用户ID不能为空');
    }
    
    // 查找用户订阅，如果不存在则创建免费版
    let subscription = await prisma.subscription.findUnique({
      where: { userId },
    });

    if (!subscription) {
      subscription = await this.createFreeSubscription(userId);
    }

    return subscription;
  }

  // 创建免费订阅
  async createFreeSubscription(userId: string) {
    if (!userId) {
      throw new Error('用户ID不能为空');
    }
    
    const quotas = planQuotas.FREE;
    return prisma.subscription.create({
      data: {
        userId,
        plan: 'FREE',
        monthlyRuleQuota: quotas.monthlyRuleQuota,
        monthlyNotifyQuota: quotas.monthlyNotifyQuota,
      },
    });
  }

  // 升级或降级用户订阅
  async changePlan(userId: string, plan: SubscriptionPlan, paymentType: 'monthly' | 'annually', paymentId?: string) {
    if (!userId) {
      throw new Error('用户ID不能为空');
    }
    
    const quotas = planQuotas[plan];
    
    return prisma.subscription.upsert({
      where: { userId },
      update: {
        plan,
        paymentType,
        paymentId,
        isActive: true,
        monthlyRuleQuota: quotas.monthlyRuleQuota,
        monthlyNotifyQuota: quotas.monthlyNotifyQuota,
      },
      create: {
        userId,
        plan,
        paymentType,
        paymentId,
        monthlyRuleQuota: quotas.monthlyRuleQuota,
        monthlyNotifyQuota: quotas.monthlyNotifyQuota,
      },
    });
  }

  // 获取用户当月使用情况
  async getCurrentMonthUsage(userId: string) {
    if (!userId) {
      throw new Error('用户ID不能为空');
    }
    
    const subscription = await this.getUserSubscription(userId);
    const currentMonth = new Date();
    currentMonth.setDate(1); // 设置为当月第一天
    
    // 查找或创建当月使用记录
    let usage = await prisma.usageStat.findUnique({
      where: {
        subscriptionId_month: {
          subscriptionId: subscription.id,
          month: currentMonth,
        }
      }
    });

    if (!usage) {
      usage = await prisma.usageStat.create({
        data: {
          subscriptionId: subscription.id,
          month: currentMonth,
          rulesUsed: 0,
          notificationsUsed: 0,
        }
      });
    }

    // 返回使用情况和配额
    return {
      usage,
      subscription,
      remainingRules: subscription.monthlyRuleQuota - usage.rulesUsed,
      remainingNotifications: subscription.monthlyNotifyQuota - usage.notificationsUsed,
    };
  }

  // 记录规则使用
  async recordRuleUsage(userId: string) {
    const { subscription, usage } = await this.getCurrentMonthUsage(userId);
    
    // 更新规则使用计数
    return prisma.usageStat.update({
      where: { id: usage.id },
      data: { rulesUsed: usage.rulesUsed + 1 },
    });
  }

  // 记录通知使用
  async recordNotificationUsage(userId: string, count: number = 1) {
    const { subscription, usage } = await this.getCurrentMonthUsage(userId);
    
    // 更新通知使用计数
    return prisma.usageStat.update({
      where: { id: usage.id },
      data: { notificationsUsed: usage.notificationsUsed + count },
    });
  }

  // 检查用户是否可以创建新规则
  async canCreateRule(userId: string) {
    const { remainingRules } = await this.getCurrentMonthUsage(userId);
    return remainingRules > 0;
  }

  // 检查用户是否可以发送通知
  async canSendNotification(userId: string, count: number = 1) {
    const { remainingNotifications } = await this.getCurrentMonthUsage(userId);
    return remainingNotifications >= count;
  }
} 
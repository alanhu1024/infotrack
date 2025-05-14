import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { trackingService } from '@/services/tracking';
import type { TrackingRule } from '@/types';

// 添加健康检查和自动恢复API端点
export async function POST(req: Request) {
  try {
    // 验证请求
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: '未授权的请求' },
        { status: 401 }
      );
    }
    
    const token = authHeader.substring(7);
    const systemToken = process.env.SYSTEM_INIT_TOKEN || 'system-init-token';
    if (token !== systemToken) {
      return NextResponse.json(
        { error: '无效的令牌' },
        { status: 401 }
      );
    }
    
    // 获取当前活跃规则，包括时间段信息
    const activeRules = await prisma.trackingRule.findMany({
      where: { isActive: true },
      include: { timeSlots: true }  // 包含timeSlots数据
    });
    
    // 获取当前正在轮询的规则
    const twitter = trackingService.getTwitterService();
    const activePollingIds = twitter.getActiveRuleIds();
    
    console.log(`[健康检查] 数据库中的活跃规则: ${activeRules.length}个, 当前轮询规则: ${activePollingIds.length}个`);
    
    // 找出应该轮询但未轮询的规则
    const rulesToRecover = activeRules.filter(rule => !activePollingIds.includes(rule.id));
    
    // 自动恢复规则
    if (rulesToRecover.length > 0) {
      console.log(`[健康检查] 发现 ${rulesToRecover.length} 个规则需要恢复轮询`);
      
      for (const rule of rulesToRecover) {
        console.log(`[健康检查] 恢复规则轮询: ${rule.id} (${rule.name})`);
        
        // 处理类型兼容性问题
        const trackingRule = {
          ...rule,
          notificationPhone: rule.notificationPhone || undefined
        };
        
        // 使用处理过的对象
        await trackingService.startTracking(trackingRule);
      }
    }
    
    // 找出不应轮询但正在轮询的规则
    const activeRuleIds = activeRules.map(rule => rule.id);
    const orphanedPollings = activePollingIds.filter(id => !activeRuleIds.includes(id));
    
    // 停止孤立的轮询任务
    if (orphanedPollings.length > 0) {
      console.log(`[健康检查] 发现 ${orphanedPollings.length} 个孤立轮询需要清理`);
      
      for (const id of orphanedPollings) {
        console.log(`[健康检查] 停止孤立轮询: ${id}`);
        twitter.stopPolling(id);
      }
    }
    
    // 重置通知状态（可选，取决于需求）
    const shouldResetNotifications = req.headers.get('X-Reset-Notifications') === 'true';
    if (shouldResetNotifications) {
      console.log(`[健康检查] 重置所有通知状态`);
      trackingService.resetNotifiedTweets();
    }
    
    return NextResponse.json({
      success: true,
      recovered: rulesToRecover.length,
      cleaned: orphanedPollings.length,
      notificationsReset: shouldResetNotifications,
      status: 'completed'
    });
  } catch (error) {
    console.error('[健康检查] 执行健康检查出错:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : '未知错误' 
      },
      { status: 500 }
    );
  }
} 
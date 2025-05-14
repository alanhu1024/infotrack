import { NextResponse } from 'next/server';
import { trackingService } from '@/services/tracking';
import { prisma } from '@/lib/prisma';

/**
 * 系统健康状态检查API
 * 用于监控系统状态和活跃规则状态
 */
export async function GET() {
  try {
    // 1. 检查数据库连接
    await prisma.$queryRaw`SELECT 1`;
    
    // 2. 获取活跃规则
    const activeRules = await prisma.trackingRule.findMany({
      where: { isActive: true },
      select: { 
        id: true, 
        name: true, 
        lastPolledAt: true,
        twitterUsername: true,
        pollingInterval: true
      }
    });
    
    // 3. 获取活跃轮询
    const twitter = trackingService.getTwitterService();
    const activePollingIds = twitter.getActiveRuleIds();
    
    // 4. 计算同步状态
    const ruleSyncStatus = activeRules.map(rule => ({
      id: rule.id,
      name: rule.name,
      twitterUsername: rule.twitterUsername,
      isPolling: activePollingIds.includes(rule.id),
      lastPolledAt: rule.lastPolledAt,
      timeSinceLastPoll: rule.lastPolledAt 
        ? Math.round((Date.now() - new Date(rule.lastPolledAt).getTime()) / 1000) 
        : null,
      pollingInterval: rule.pollingInterval,
      shouldPoll: rule.lastPolledAt 
        ? (Date.now() - new Date(rule.lastPolledAt).getTime()) > rule.pollingInterval * 1000
        : true,
      status: activePollingIds.includes(rule.id) ? '正常轮询中' : '未轮询'
    }));

    // 检查不一致状态的规则
    const inconsistentRules = ruleSyncStatus.filter(rule => 
      rule.isPolling !== true && rule.shouldPoll === true
    );
    
    // 5. 返回详细状态
    return NextResponse.json({
      status: inconsistentRules.length === 0 ? 'healthy' : 'warning',
      databaseConnected: true,
      activeRulesCount: activeRules.length,
      activePollingCount: activePollingIds.length,
      allPollingIds: activePollingIds,
      ruleSyncStatus,
      inconsistentRules,
      serverTime: new Date().toISOString(),
      memoryUsage: process.memoryUsage(),
    });
  } catch (error) {
    return NextResponse.json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 
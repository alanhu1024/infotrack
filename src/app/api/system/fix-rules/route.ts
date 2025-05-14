import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { trackingService } from '@/services/tracking';

// 为了安全，使用一个环境变量或固定的特殊密钥
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'admin-api-key-for-maintenance';

export async function POST(req: Request) {
  // 验证API密钥
  const apiKey = req.headers.get('X-Admin-API-Key');
  if (apiKey !== ADMIN_API_KEY) {
    return NextResponse.json({ success: false, message: '未授权访问' }, { status: 401 });
  }
  
  try {
    console.log('[系统修复] 开始修复规则状态...');
    
    // 1. 首先清理所有活跃的轮询
    const twitter = trackingService.getTwitterService();
    
    // 获取并记录当前活跃的轮询
    const activeRuleIds = twitter.getActiveRuleIds();
    console.log(`[系统修复] 当前活跃轮询: ${activeRuleIds.length}个`, activeRuleIds);
    
    // 停止所有轮询
    twitter.clearAllPollingJobs();
    twitter.forceCleanupPolling();
    console.log('[系统修复] 已清理所有定时器');
    
    // 2. 获取cmag2ymff0001t4cpaofqhh3s规则的详细信息
    const targetRule = await prisma.trackingRule.findUnique({
      where: { id: 'cmag2ymff0001t4cpaofqhh3s' }
    });
    
    console.log('[系统修复] 目标规则详情:', targetRule ? 
      JSON.stringify({
        id: targetRule.id,
        name: targetRule.name,
        isActive: targetRule.isActive,
        lastPolledAt: targetRule.lastPolledAt
      }) : '规则不存在');
    
    // 3. 更新所有规则为非活跃状态
    const updateResult = await prisma.trackingRule.updateMany({
      data: { 
        isActive: false,
        lastPolledAt: null 
      }
    });
    
    console.log(`[系统修复] 已将 ${updateResult.count} 条规则设为非活跃`);
    
    // 4. 最后检查系统状态
    const remainingActive = twitter.getActiveRuleIds();
    console.log(`[系统修复] 当前活跃轮询: ${remainingActive.length}个`, remainingActive);
    
    return NextResponse.json({
      success: true,
      message: '规则状态已修复',
      details: {
        rulesUpdated: updateResult.count,
        beforeFix: activeRuleIds,
        afterFix: remainingActive
      }
    });
  } catch (error) {
    console.error('[系统修复] 修复规则状态失败:', error);
    return NextResponse.json({
      success: false,
      message: '修复失败',
      error: error instanceof Error ? error.message : '未知错误'
    }, { status: 500 });
  }
} 
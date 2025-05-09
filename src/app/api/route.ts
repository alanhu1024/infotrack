import { NextRequest, NextResponse } from 'next/server';
import { trackingService } from '@/services/tracking';
import { initializeTracking } from '@/services/tracking/boot';

// 简单的健康检查终端点
export async function GET(req: NextRequest) {
  console.log('[API] 接收到健康检查请求');
  
  try {
    // 获取活跃规则
    const activeRuleIds = trackingService['twitter'].getActiveRuleIds();
    console.log(`[API] 当前系统中有 ${activeRuleIds.length} 个活跃规则`);
    
    // 如果没有活跃规则，尝试初始化
    if (activeRuleIds.length === 0) {
      console.log('[API] 未检测到活跃规则，尝试初始化系统');
      await initializeTracking();
      
      // 再次检查
      const updatedRuleIds = trackingService['twitter'].getActiveRuleIds();
      console.log(`[API] 初始化后，系统中有 ${updatedRuleIds.length} 个活跃规则`);
    }
    
    return NextResponse.json({
      status: 'ok',
      message: '系统正常运行',
      timestamp: new Date().toISOString(),
      activeRules: trackingService['twitter'].getActiveRuleIds().length
    });
  } catch (error) {
    console.error('[API] 健康检查失败:', error);
    return NextResponse.json({
      status: 'error',
      message: '系统异常',
      error: String(error)
    }, { status: 500 });
  }
} 
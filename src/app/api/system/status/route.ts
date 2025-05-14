import { NextResponse } from 'next/server';
import { trackingService } from '@/services/tracking';

// 添加初始化状态检查API
export async function GET() {
  try {
    const twitter = trackingService.getTwitterService();
    
    // 获取系统状态信息
    const activeRuleIds = twitter.getActiveRuleIds();
    
    return NextResponse.json({
      success: true,
      initialized: true,
      status: {
        activeRules: activeRuleIds.length,
        activeRuleIds,
        serverTime: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[API] 获取系统状态失败:', error);
    return NextResponse.json({
      success: false,
      initialized: false,
      error: error instanceof Error ? error.message : '未知错误'
    }, { status: 500 });
  }
} 
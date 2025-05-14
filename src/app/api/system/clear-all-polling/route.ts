import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { trackingService } from '@/services/tracking';
import { authOptions } from '@/lib/auth';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ success: false, message: '未授权' }, { status: 401 });
  }
  
  try {
    console.log(`[系统清理] 开始清理所有轮询和系统状态`);
    
    // 使用TrackingService的清理所有规则方法
    const result = await trackingService.clearAllRules();
    
    // 清空全局状态
    if (global.__trackingNotifiedTweets) {
      const size = global.__trackingNotifiedTweets.size;
      global.__trackingNotifiedTweets.clear();
      console.log(`[系统清理] 已清空通知状态集合 (原大小: ${size})`);
    }
    
    // 返回结果
    return NextResponse.json({ 
      success: result.success, 
      message: result.success ? '已清空所有轮询和状态' : '清理过程中出现错误',
      details: {
        rulesUpdated: result.count,
      }
    });
  } catch (error) {
    console.error('[系统清理] 清空系统状态失败:', error);
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ 
      success: false, 
      message: '操作失败', 
      error: errorMessage 
    }, { status: 500 });
  }
} 
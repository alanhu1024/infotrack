import { NextResponse } from 'next/server';
import { initializeTracking } from '@/services/tracking/boot';
import { toBeiJingTime } from '@/services/twitter';

// 客户端初始化端点 - 简化为使用共享的初始化逻辑
export async function GET() {
  try {
    console.log(`[API ${toBeiJingTime(new Date())}] 系统启动初始化...`);
    
    // 依赖initializeTracking的内部重复初始化检测
    await initializeTracking();
    
    return NextResponse.json({ 
      success: true, 
      message: '系统初始化完成' 
    });
  } catch (error) {
    console.error(`[API ${toBeiJingTime(new Date())}] 系统初始化失败:`, error);
    return NextResponse.json({ 
      success: false, 
      message: '初始化失败',
      error: error instanceof Error ? error.message : '未知错误'
    }, { status: 500 });
  }
} 
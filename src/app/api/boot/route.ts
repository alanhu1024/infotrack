import { NextResponse } from 'next/server';
import { trackingService } from '@/services/tracking';
import { initializeTracking } from '@/services/tracking/boot';

// 导入boot模块，确保自动初始化功能被加载
// 这会触发模块内的setupAutoInitialization函数执行
import '@/services/tracking/boot';

// 导入专用的服务器初始化模块
import './server-init';

// 系统启动路由，调用此端点初始化所有服务
export async function GET() {
  console.log('[API] 系统启动初始化...');
  
  try {
    // 检查是否在构建阶段
    const isBuildTime = process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL;
    
    if (isBuildTime) {
      // 构建时返回一个简单的成功响应，而不实际初始化服务
      console.log('[API] 检测到在构建阶段，跳过实际初始化');
      return NextResponse.json({ 
        success: true, 
        message: '构建阶段，跳过服务初始化',
        isBuildTime: true
      });
    }
    
    // 运行时环境，初始化追踪服务
    await initializeTracking();
    
    return NextResponse.json({ 
      success: true, 
      message: '系统服务初始化完成',
      activeRules: trackingService['twitter'].getActiveRuleIds().length
    });
  } catch (error) {
    console.error('[API] 初始化失败:', error);
    return NextResponse.json(
      { success: false, message: '初始化失败', error: String(error) },
      { status: 500 }
    );
  }
} 
import { NextRequest, NextResponse } from 'next/server';
import { initializeTracking } from '@/services/tracking/boot';

// 使用全局变量跟踪状态
let isSystemInitialized = false;
let isInitializing = false;
let lastInitTime = 0;

export async function middleware(req: NextRequest) {
  // 执行初始化检查
  if (!isSystemInitialized && !isInitializing) {
    const now = Date.now();
    
    // 避免频繁初始化
    if (now - lastInitTime > 5 * 60 * 1000) { // 至少间隔5分钟
      isInitializing = true;
      
      try {
        console.log('[Middleware] 开始初始化系统服务...');
        await initializeTracking();
        console.log('[Middleware] 系统服务初始化完成');
        
        isSystemInitialized = true;
        lastInitTime = now;
      } catch (error) {
        console.error('[Middleware] 系统初始化失败:', error);
      } finally {
        isInitializing = false;
      }
    }
  }
  
  // 继续处理请求
  return NextResponse.next();
} 
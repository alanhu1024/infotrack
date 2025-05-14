import { NextResponse } from 'next/server';
import { initializeTracking } from '@/services/tracking/boot';

// 导入外部状态而不是维护自己的状态
// 以减少多处初始化的问题

export async function POST(req: Request) {
  // 验证请求
  const initToken = req.headers.get('X-System-Init-Token');
  const systemToken = process.env.SYSTEM_INIT_TOKEN || 'system-init-token';
  
  if (initToken !== systemToken) {
    console.error('[API] 系统初始化请求未授权');
    return NextResponse.json(
      { error: '未授权的请求' },
      { status: 401 }
    );
  }
  
  try {
    console.log('[API] 开始初始化系统服务...');
    
    // 执行初始化 - 由initializeTracking内部控制重复初始化
    await initializeTracking();
    
    console.log('[API] 系统服务初始化完成');
    return NextResponse.json({ status: 'success' });
  } catch (error) {
    console.error('[API] 系统初始化失败:', error);
    return NextResponse.json(
      { status: 'error', message: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    );
  }
} 
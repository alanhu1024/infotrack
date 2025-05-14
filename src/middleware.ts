import { withAuth } from "next-auth/middleware";
import { NextResponse, NextRequest } from "next/server";

// 使用全局变量跟踪状态
let isSystemInitializing = false;
let lastInitTime = 0;
let hasInitialized = false; // 添加标记，表示系统是否已经初始化过

// 自定义中间件函数
async function customMiddleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  
  // 针对首次访问系统和API请求触发系统初始化
  // 增加条件：只有首页访问或dashboard才触发初始化，避免所有API都触发
  const shouldInitialize = (path === '/' || path === '/dashboard') && !hasInitialized;

  if (shouldInitialize && !isSystemInitializing) {
    const now = Date.now();
    
    // 避免频繁初始化，至少间隔10分钟（从5分钟改为10分钟）
    if (now - lastInitTime > 10 * 60 * 1000) {
      isSystemInitializing = true;
      lastInitTime = now;
      
      // 异步触发初始化API，不等待结果
      try {
        console.log('[Middleware] 发送初始化系统请求...');
        
        // 创建一个不带凭证的fetch请求，避免在中间件中使用cookie
        fetch(new URL('/api/system/initialize', req.nextUrl.origin).toString(), {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            // 添加一个秘密令牌用于验证请求来源
            'X-System-Init-Token': process.env.SYSTEM_INIT_TOKEN || 'system-init-token'
          }
        }).then(() => {
          console.log('[Middleware] 系统初始化请求已发送');
          hasInitialized = true; // 标记系统已初始化
        }).catch(error => {
          console.error('[Middleware] 发送初始化请求失败:', error);
        }).finally(() => {
          // 请求完成后重置标志
          isSystemInitializing = false;
        });
      } catch (error) {
        console.error('[Middleware] 创建初始化请求失败:', error);
        isSystemInitializing = false;
      }
    }
  }
  
  return NextResponse.next();
}

// 使用withAuth包装自定义中间件
const authMiddleware = withAuth(
  async function middleware(req) {
    // 先执行自定义中间件逻辑
    await customMiddleware(req as NextRequest);
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

// 导出最终的中间件函数
export default async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  
  // 如果是需要认证的路径，使用authMiddleware
  if (
    path.startsWith('/dashboard') || 
    path.startsWith('/settings') || 
    path.startsWith('/api/protected')
  ) {
    // 类型转换，解决类型错误
    return authMiddleware(req as any, {} as any);
  }
  
  // 否则使用自定义中间件
  return await customMiddleware(req);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/settings/:path*",
    "/api/:path*",
    "/api/protected/:path*",
  ],
}; 
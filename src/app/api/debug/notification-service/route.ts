import { NextResponse } from 'next/server';
import { notificationServices } from '@/services/notification';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET() {
  try {
    // 检查权限
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    // 获取所有可用的通知服务
    const services = Array.from(notificationServices.keys());
    
    // 获取百度智能外呼服务的详细信息
    const baiduCallingService = notificationServices.get('baidu-calling');
    
    // 构建响应数据
    const response = {
      success: true,
      availableServices: services,
      baiduCallingService: {
        exists: !!baiduCallingService,
        methods: baiduCallingService ? Object.getOwnPropertyNames(
          Object.getPrototypeOf(baiduCallingService)
        ).filter(m => m !== 'constructor') : []
      },
      timestamp: new Date().toISOString()
    };
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('[API] 检查通知服务失败:', error);
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: '检查通知服务失败', details: errorMessage }, { status: 500 });
  }
} 
import { NextResponse } from 'next/server';
import { trackingService } from '@/services/tracking';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    // 验证用户身份
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json(
        { error: '未授权访问，请先登录' },
        { status: 401 }
      );
    }

    // 解析请求数据
    const data = await request.json();
    const { ruleId } = data;

    // 执行重置操作
    trackingService.resetNotificationStatus(ruleId);
    
    return NextResponse.json({
      success: true,
      message: ruleId 
        ? `已重置规则 ${ruleId} 的通知状态`
        : '已重置所有通知状态'
    });
  } catch (error: any) {
    console.error('[API] 重置通知状态失败:', error);
    return NextResponse.json(
      { error: `重置通知状态失败: ${error.message}` },
      { status: 500 }
    );
  }
} 
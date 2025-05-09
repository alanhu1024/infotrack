import { NextResponse } from 'next/server';
import { trackingService } from '@/services/tracking';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    // 获取当前用户会话
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: '未登录或会话已过期' },
        { status: 401 }
      );
    }

    // 重置通知状态
    trackingService.resetNotifiedTweets();

    return NextResponse.json({ 
      success: true, 
      message: '已成功重置通知状态，下次检测到推文将发送新通知'
    });
  } catch (error) {
    console.error('重置通知状态失败:', error);
    return NextResponse.json(
      { error: '重置通知状态失败' },
      { status: 500 }
    );
  }
} 
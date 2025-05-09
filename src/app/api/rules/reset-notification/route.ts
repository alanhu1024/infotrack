import { NextRequest, NextResponse } from 'next/server';
import { trackingService } from '@/services/tracking';
import { isAdminSession } from '@/lib/auth';

// API处理程序 - 重置规则通知状态
export async function POST(req: NextRequest) {
  try {
    // 检查管理员权限
    const isAdmin = await isAdminSession();
    if (!isAdmin) {
      return NextResponse.json({ error: '权限不足' }, { status: 403 });
    }

    // 获取请求体
    const body = await req.json();
    const { ruleId } = body;

    if (!ruleId) {
      return NextResponse.json({ error: '缺少规则ID参数' }, { status: 400 });
    }

    // 调用服务重置通知状态
    console.log(`[API] 重置规则 ${ruleId} 的通知状态`);
    trackingService.resetNotifiedTweets();

    return NextResponse.json({
      success: true,
      message: `已重置规则 ${ruleId} 的通知状态`
    });
  } catch (error) {
    console.error('[API] 重置通知状态失败:', error);
    return NextResponse.json({ error: '重置通知状态失败' }, { status: 500 });
  }
} 
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { trackingService } from '@/services/tracking';
import { authOptions } from '@/lib/auth';

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ success: false, message: '未授权' }, { status: 401 });
  }

  try {
    const id = params.id;
    
    // 获取规则
    const rule = await prisma.trackingRule.findUnique({
      where: { id }
    });
    
    if (!rule) {
      return NextResponse.json({ success: false, message: '规则不存在' }, { status: 404 });
    }
    
    // 确保用户只能管理自己的规则
    if (rule.userId !== session.user.id) {
      return NextResponse.json({ success: false, message: '无权限' }, { status: 403 });
    }
    
    // 停止追踪并更新数据库状态
    await trackingService.stopTracking(rule.id, rule.name);
    
    // 强制执行第二次清理，确保停止
    const twitter = trackingService.getTwitterService();
    twitter.forceCleanupPolling(rule.id);
    
    // 更新规则状态
    const updatedRule = await prisma.trackingRule.update({
      where: { id },
      data: { isActive: false },
      include: { timeSlots: true },
    });
    
    return NextResponse.json({ 
      success: true, 
      rule: updatedRule,
      message: '已强制停止规则轮询'
    });
  } catch (error) {
    console.error('强制停止规则失败:', error);
    return NextResponse.json(
      { success: false, message: '强制停止规则失败', error: String(error) },
      { status: 500 }
    );
  }
} 
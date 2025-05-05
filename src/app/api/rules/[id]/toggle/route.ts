import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { TrackingService, trackingService } from '@/services/tracking';
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
      where: { id },
      include: { timeSlots: true },
    });
    
    if (!rule) {
      return NextResponse.json({ success: false, message: '规则不存在' }, { status: 404 });
    }
    
    // 确保用户只能管理自己的规则
    if (rule.userId !== session.user.id) {
      return NextResponse.json({ success: false, message: '无权限' }, { status: 403 });
    }
    
    // 切换规则状态
    const updatedRule = await prisma.trackingRule.update({
      where: { id },
      data: { isActive: !rule.isActive },
      include: { timeSlots: true },
    });
    
    // 根据新状态启用或停用追踪
    if (updatedRule.isActive) {
      await trackingService.startTracking(updatedRule);
    } else {
      await trackingService.stopTracking(updatedRule);
    }
    
    return NextResponse.json({ success: true, rule: updatedRule });
  } catch (error) {
    console.error('Error toggling rule:', error);
    return NextResponse.json(
      { success: false, message: '切换规则失败', error: String(error) },
      { status: 500 }
    );
  }
} 
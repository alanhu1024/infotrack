import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const prisma = new PrismaClient();

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: '未登录或会话已过期' },
        { status: 401 }
      );
    }

    const rule = await prisma.trackingRule.findUnique({
      where: { id: params.id },
    });

    if (!rule) {
      return NextResponse.json(
        { error: '规则不存在' },
        { status: 404 }
      );
    }

    if (rule.userId !== session.user.id) {
      return NextResponse.json(
        { error: '无权修改此规则' },
        { status: 403 }
      );
    }

    // 切换规则状态
    const updatedRule = await prisma.trackingRule.update({
      where: { id: params.id },
      data: { isActive: !rule.isActive },
    });

    return NextResponse.json(updatedRule);
  } catch (error) {
    console.error('Error toggling rule:', error);
    return NextResponse.json(
      { error: '切换规则状态失败' },
      { status: 500 }
    );
  }
} 
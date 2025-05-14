import { NextRequest, NextResponse } from 'next/server';
import { trackingService } from '@/services/tracking';
import { isAdminSession } from '@/lib/auth';
import { authOptions } from '@/lib/auth';
import { getServerSession } from 'next-auth/next';
import { prisma } from '@/lib/prisma';

// API处理程序 - 重置规则通知状态
export async function POST(req: Request) {
  try {
    // 验证用户登录
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    // 获取请求参数
    const data = await req.json();
    const { ruleId } = data;

    if (!ruleId) {
      return NextResponse.json({ error: '缺少规则ID' }, { status: 400 });
    }

    // 验证规则存在
    const rule = await prisma.trackingRule.findUnique({
      where: { id: ruleId }
    });

    if (!rule) {
      return NextResponse.json({ error: '规则不存在' }, { status: 404 });
    }

    // 验证权限
    if (rule.userId !== session.user.id) {
      const isAdmin = session.user.email === process.env.ADMIN_EMAIL;
      if (!isAdmin) {
        return NextResponse.json({ error: '无权操作此规则' }, { status: 403 });
      }
    }

    // 重置通知状态
    console.log(`[API] 重置规则 ${ruleId} (${rule.name}) 的通知状态`);
    
    // 从内存中移除通知标记
    trackingService.resetNotificationStatus(ruleId);
    
    // 更新数据库中的通知状态
    let updateCount = 0;
    const tweets = await prisma.tweet.findMany({
      where: { matchedRuleId: ruleId }
    });
    
    for (const tweet of tweets) {
      try {
        // 单独更新每条推文，避免批量更新类型问题
        await prisma.tweet.update({
          where: { id: tweet.id },
          data: { 
            // 确保字段名称正确匹配数据库表结构
            notified: false,
            notifiedAt: null
          }
        });
        updateCount++;
      } catch (error) {
        console.error(`[API] 更新推文 ${tweet.id} 状态失败:`, error);
      }
    }
    
    return NextResponse.json({
      success: true,
      message: `已重置规则 ${rule.name} 的通知状态`,
      resetCount: updateCount,
      totalTweets: tweets.length
    });
  } catch (error) {
    console.error('[API] 重置通知状态失败:', error);
    return NextResponse.json(
      { error: '操作失败: ' + (error instanceof Error ? error.message : String(error)) }, 
      { status: 500 }
    );
  }
} 
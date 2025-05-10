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
    
    // 1. 更新数据库中该规则相关的所有推文通知状态
    const updateResult = await prisma.tweet.updateMany({
      where: { matchedRuleId: id },
      data: { 
        notified: false,
        notifiedAt: null
      }
    });
    
    // 2. 重置内存中的通知状态
    // 通过查询所有相关的推文ID
    const tweets = await prisma.tweet.findMany({
      where: { matchedRuleId: id },
      select: { tweetId: true }
    });
    
    // 获取内存中已通知推文集合的引用
    const notifiedTweets = (global.__trackingNotifiedTweets as Set<string>) || new Set<string>();
    
    // 从集合中移除这些推文ID
    let removedCount = 0;
    tweets.forEach(tweet => {
      if (notifiedTweets.has(tweet.tweetId)) {
        notifiedTweets.delete(tweet.tweetId);
        removedCount++;
      }
    });
    
    return NextResponse.json({ 
      success: true, 
      message: '已重置规则的通知状态',
      details: {
        databaseUpdated: updateResult.count,
        memoryReset: removedCount
      }
    });
  } catch (error) {
    console.error('重置通知状态失败:', error);
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json(
      { success: false, message: '重置通知状态失败', error: errorMessage },
      { status: 500 }
    );
  }
} 
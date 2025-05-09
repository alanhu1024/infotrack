import { NextRequest, NextResponse } from 'next/server';
import { trackingService } from '@/services/tracking';
import { isAdminSession } from '@/lib/auth';

/**
 * 测试轮询通知机制的API端点
 * 用于验证轮询完成后的通知回调是否正常工作
 */
export async function GET(req: NextRequest) {
  try {
    // 检查管理员权限
    const isAdmin = await isAdminSession();
    if (!isAdmin) {
      return NextResponse.json(
        { success: false, message: '无权访问' },
        { status: 403 }
      );
    }

    // 重置所有通知状态
    trackingService.resetNotifiedTweets();

    // 获取活跃规则列表
    const activeRules = trackingService['twitter'].getActiveRuleIds();
    
    // 创建测试推文数据
    const testTweets = [
      {
        id: `test_${Date.now()}`,
        text: '这是一条测试大模型推文，用于验证通知机制',
        authorId: 'test_author',
        score: 0.95,
        explanation: '测试推文，强制触发通知'
      }
    ];

    // 查找第一个活跃规则
    const ruleId = activeRules.find(id => !id.includes('_delay'));
    
    if (ruleId) {
      // 获取规则详情
      const rule = await trackingService['prisma'].trackingRule.findUnique({
        where: { id: ruleId },
        include: { timeSlots: true }
      });

      if (rule) {
        console.log(`[TestNotification] 找到活跃规则: ${rule.id} (${rule.name})`);
        
        // 手动触发队列处理
        try {
          console.log(`[TestNotification] 手动触发通知处理，推文数: ${testTweets.length}`);
          await trackingService.handleMatchedTweets(rule, testTweets);
          console.log(`[TestNotification] 通知处理完成`);
          
          return NextResponse.json({
            success: true,
            message: '通知测试成功完成',
            ruleId: rule.id,
            ruleName: rule.name,
            tweetCount: testTweets.length
          });
        } catch (error) {
          console.error(`[TestNotification] 处理通知失败:`, error);
          return NextResponse.json(
            { 
              success: false, 
              message: '处理通知失败', 
              error: String(error),
              ruleId: rule.id
            },
            { status: 500 }
          );
        }
      }
    }

    return NextResponse.json({
      success: false,
      message: '未找到活跃规则',
      activeRules
    });
  } catch (error) {
    console.error(`[TestNotification] 测试通知失败:`, error);
    return NextResponse.json(
      { success: false, message: '测试通知失败', error: String(error) },
      { status: 500 }
    );
  }
} 
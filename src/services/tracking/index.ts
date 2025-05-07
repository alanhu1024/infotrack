import { TwitterService, twitterServiceSingleton } from '../twitter';
import { AIService } from '../ai';
import { PrismaClient } from '@prisma/client';
import type { Tweet, TrackingRule, NotificationChannel } from '@/types';
import { OpenAIService } from '../llm/openai';
import { AliService } from '../llm/ali';
import { prisma } from '@/lib/prisma';
import { notificationServices } from '@/services/notification';
import { env } from '@/config/env';

// 声明全局单例
declare global {
  var __trackingServiceInstance: TrackingService | null;
  // 添加已通知的推文ID集合，避免重复通知
  var __trackingNotifiedTweets: Set<string> | null;
}

// 单例实例引用
let trackingServiceInstance: TrackingService | null = global.__trackingServiceInstance || null;

// 创建全局的已通知推文集合
if (!global.__trackingNotifiedTweets) {
  global.__trackingNotifiedTweets = new Set<string>();
  console.log('[TrackingService] 创建全局已通知推文追踪Set');
}

// 定义推文处理结果接口
interface TweetProcessResult {
  matched: boolean;
  score: number;
  explanation: string;
}

export class TrackingService {
  constructor(
    private twitter: TwitterService,
    private ai: AIService,
    private prisma: PrismaClient
  ) {
    if (trackingServiceInstance) {
      throw new Error('TrackingService 已存在，请使用 trackingService 导出实例');
    }
    console.log('[TrackingService] 创建新实例 (单例)');
  }

  // 添加访问已通知推文集合的getter
  private get notifiedTweets(): Set<string> {
    return global.__trackingNotifiedTweets as Set<string>;
  }

  // 获取单例实例的静态方法 
  public static getInstance(): TrackingService {
    if (!trackingServiceInstance) {
      trackingServiceInstance = new TrackingService(
        twitterServiceSingleton,
        { /* AIService */ } as any,
        prisma
      );
      // 保存到全局对象
      global.__trackingServiceInstance = trackingServiceInstance;
    }
    return trackingServiceInstance;
  }

  async startTracking(rule: TrackingRule): Promise<void> {
    console.log(`[TrackingService] startTracking 参数:`, JSON.stringify(rule, null, 2));
    console.log('[TrackingService] 当前所有定时器key:', Array.from(this.twitter['pollingJobs'].keys()));
    if (!rule.isActive) {
      console.log(`[TrackingService] 规则 ${rule.id} 未启用，跳过追踪。`);
      return;
    }

    console.log(`[TrackingService] 启动规则追踪: ${rule.id} (${rule.name})`);

    // 存储匹配的推文信息，用于后续通知
    const matchedTweets: Array<{
      id: string;
      text: string;
      authorId: string;
      score: number;
      explanation: string;
    }> = [];

    // 处理推文的回调函数
    const handleTweet = async (tweet: {
      id: string;
      text: string;
      authorId: string;
      createdAt: Date;
    }): Promise<TweetProcessResult> => {
      try {
        console.log(`[TrackingService] 检测到推文:`, tweet);
        // 动态选择大模型服务
        let llm;
        if (rule.llmProvider === 'ali') {
          llm = new AliService(env.ALI_API_KEY);
        } else {
          llm = new OpenAIService(rule.llmApiKey);
        }
        // 分析推文相关性
        const analysis = await llm.analyzeTextRelevance(tweet.text, rule.criteria);
        console.log(`[TrackingService] 推文分析结果:`, analysis);
        // 新增详细输出
        console.log(`[TrackingService] 相关性分数: ${analysis.relevanceScore}, 说明: ${analysis.explanation}`);
        
        // 默认结果对象
        const result = {
          matched: false,
          score: analysis.relevanceScore,
          explanation: analysis.explanation
        };
        
        // 如果相关性分数超过阈值，保存推文
        if (analysis.relevanceScore >= 0.7) {
          // 设置匹配状态为true
          result.matched = true;
          
          // 保存推文到数据库
          await this.prisma.tweet.upsert({
            where: { tweetId: tweet.id },
            update: {}, // 已存在时不做任何更新
            create: {
              tweetId: tweet.id,
              authorId: tweet.authorId,
              content: tweet.text,
              matchedRuleId: rule.id,
              analysis: {
                create: {
                  relevanceScore: analysis.relevanceScore,
                  analysisResult: analysis.explanation,
                },
              },
            },
          });
          console.log(`[TrackingService] 推文已保存:`, tweet.id);
          
          // 添加到匹配推文列表，稍后处理通知
          matchedTweets.push({
            id: tweet.id,
            text: tweet.text,
            authorId: tweet.authorId,
            score: analysis.relevanceScore,
            explanation: analysis.explanation
          });
        } else {
          console.log(`[TrackingService] 推文相关性分数过低，未保存。`);
        }
        
        // 返回处理结果
        return result;
      } catch (error) {
        console.error(`[TrackingService] 处理推文出错:`, error);
        // 发生错误时返回未匹配状态
        return { matched: false, score: 0, explanation: `处理出错: ${error}` };
      }
    };

    // 包装原有 handleTweet
    const handleTweetWithUpdate = async (tweet: {
      id: string;
      text: string;
      authorId: string;
      createdAt: Date;
    }): Promise<TweetProcessResult> => {
      // 调用原始处理函数并获取结果
      const result = await handleTweet(tweet);
      
      // 每次处理推文后都更新时间
      await this.updateLastPolledAt(rule.id);
      
      // 返回处理结果给调用者
      return result;
    };

    // 装饰Twitter服务的startPolling方法，在轮询完成后检查匹配数量并发送通知
    const originalStartPolling = this.twitter.startPolling.bind(this.twitter);
    this.twitter.startPolling = async (rule, callback) => {
      // 处理轮询结果的包装回调
      const wrappedCallback = async (tweet: any) => {
        const result = await callback(tweet);
        return result;
      };

      // 调用原始startPolling方法
      await originalStartPolling(rule, wrappedCallback);
      
      // 轮询完成后，如果有匹配推文，发送通知
      if (matchedTweets.length > 0) {
        console.log(`[TrackingService] 本次轮询中匹配推文数量: ${matchedTweets.length}，准备发送通知`);
        
        try {
          // 获取规则详细信息，包括手机号码
          const ruleDetails = await this.prisma.trackingRule.findUnique({
            where: { id: rule.id },
            include: {
              user: true
            }
          });
          
          // 如果设置了通知手机号码，使用百度智能外呼
          if (ruleDetails?.notificationPhone) {
            try {
              // 过滤出未通知过的推文
              const unnotifiedTweets = matchedTweets.filter(t => !this.notifiedTweets.has(t.id));
              
              // 记录原始数量和过滤后数量，便于调试
              console.log(`[TrackingService] 原始匹配推文: ${matchedTweets.length}条, 未通知的推文: ${unnotifiedTweets.length}条`);
              
              // 只有存在未通知过的推文时才发送通知
              if (unnotifiedTweets.length > 0) {
                console.log(`[TrackingService] 发现 ${unnotifiedTweets.length} 条未通知的匹配推文，将通过百度智能外呼通知用户: ${ruleDetails.notificationPhone}`);
                const baiduCallingService = notificationServices.get('baidu-calling');
                
                if (baiduCallingService) {
                  // 选择得分最高的推文作为通知内容
                  const highestScoringTweet = unnotifiedTweets.reduce(
                    (highest, current) => current.score > highest.score ? current : highest, 
                    unnotifiedTweets[0]
                  );
                  
                  await baiduCallingService.send({
                    userId: ruleDetails.notificationPhone,
                    channelId: 'phone',
                    title: `检测到${unnotifiedTweets.length}条匹配规则"${ruleDetails.name}"的推文`,
                    content: `您有重要通知，本次检测到${unnotifiedTweets.length}条匹配规则"${ruleDetails.name}"的内容，可以打开infotrack查看详情。`,
                    metadata: {
                      matchCount: unnotifiedTweets.length,
                      tweetId: highestScoringTweet.id,
                      authorId: highestScoringTweet.authorId,
                      ruleId: rule.id,
                      ruleName: rule.name,
                      relevanceScore: highestScoringTweet.score,
                      analysisResult: highestScoringTweet.explanation
                    }
                  });
                  
                  // 标记所有推文为已通知
                  unnotifiedTweets.forEach(t => {
                    this.notifiedTweets.add(t.id);
                  });
                  
                  console.log(`[TrackingService] 已成功发送百度智能外呼通知并记录 ${unnotifiedTweets.length} 条推文为已通知状态`);
                } else {
                  console.warn(`[TrackingService] 百度智能外呼服务未配置，跳过通知`);
                }
              } else {
                console.log(`[TrackingService] 所有匹配推文都已通知过，跳过通知。当前已通知推文总数: ${this.notifiedTweets.size}`);
                
                // 输出几个已通知的推文ID示例，帮助调试
                const notifiedIds = Array.from(this.notifiedTweets).slice(0, 3);
                console.log(`[TrackingService] 已通知推文ID示例: ${notifiedIds.join(', ')}${this.notifiedTweets.size > 3 ? '...' : ''}`);
                
                // 检查当前批次中的推文ID是否确实在已通知集合中
                const allInNotified = matchedTweets.every(t => this.notifiedTweets.has(t.id));
                console.log(`[TrackingService] 当前所有推文确实已在通知列表中: ${allInNotified}`);
                
                // 提前获取服务引用
                const baiduCallingService = notificationServices.get('baidu-calling');
                
                if (!allInNotified) {
                  // 找出哪些推文应该在已通知列表但实际不在
                  const missingTweets = matchedTweets.filter(t => !this.notifiedTweets.has(t.id));
                  console.log(`[TrackingService] 发现 ${missingTweets.length} 条推文不在已通知列表中，但被过滤掉了，可能存在逻辑问题`);
                  
                  // 这种情况通常不应该发生，如果发生了可能表明系统中存在逻辑错误
                  // 为防止重要通知丢失，强制发送这些推文的通知
                  if (missingTweets.length > 0 && baiduCallingService) {
                    console.log(`[TrackingService] 尝试强制发送这些遗漏的通知...`);
                    
                    const highestMissingTweet = missingTweets.reduce(
                      (highest, current) => current.score > highest.score ? current : highest, 
                      missingTweets[0]
                    );
                    
                    await baiduCallingService.send({
                      userId: ruleDetails.notificationPhone,
                      channelId: 'phone',
                      title: `检测到${missingTweets.length}条新的匹配规则"${ruleDetails.name}"的推文`,
                      content: `您有重要通知，本次检测到${missingTweets.length}条匹配规则"${ruleDetails.name}"的内容，可以打开infotrack查看详情。`,
                      metadata: {
                        matchCount: missingTweets.length,
                        tweetId: highestMissingTweet.id,
                        authorId: highestMissingTweet.authorId,
                        ruleId: rule.id,
                        ruleName: rule.name,
                        relevanceScore: highestMissingTweet.score,
                        analysisResult: highestMissingTweet.explanation
                      }
                    });
                    
                    // 标记这些推文为已通知
                    missingTweets.forEach(t => {
                      this.notifiedTweets.add(t.id);
                    });
                    
                    console.log(`[TrackingService] 已成功强制发送百度智能外呼通知并记录 ${missingTweets.length} 条推文为已通知状态`);
                  }
                }
              }
            } catch (notifyError) {
              console.error(`[TrackingService] 发送百度智能外呼通知失败:`, notifyError);
            }
          } else {
            console.log(`[TrackingService] 规则未配置通知手机号码，跳过通知`);
          }
        } catch (error) {
          console.error(`[TrackingService] 处理通知出错:`, error);
        }
        
        // 清空匹配推文列表，为下次轮询准备
        matchedTweets.length = 0;
      } else {
        console.log(`[TrackingService] 本次轮询中没有匹配推文，不发送通知`);
      }
    };

    // 启动轮询
    console.log(`[TrackingService] 启动 Twitter 轮询...`);
    await this.twitter.startPolling(rule, handleTweetWithUpdate);
  }

  async stopTracking(ruleId: string, ruleName?: string): Promise<void> {
    console.log(`[TrackingService] 停止规则追踪: ${ruleId}${ruleName ? ` (${ruleName})` : ''}`);
    console.log('[TrackingService] 停止前所有定时器key:', Array.from(this.twitter['pollingJobs'].keys()));
    
    // 检查是否有活跃定时器，同时考虑延迟定时器
    const isActive = this.twitter.isPolling(ruleId);
    
    if (!isActive) {
      console.log(`[TrackingService] 规则 ${ruleId} 没有活跃定时器，无需停止。`);
    } else {
      // 确保停止所有定时器
      this.twitter.stopPolling(ruleId);
      console.log(`[TrackingService] 已停止规则 ${ruleId} 的追踪`);
    }
    
    // 获取数据库中的规则信息
    try {
      const rule = await this.prisma.trackingRule.findUnique({
        where: { id: ruleId }
      });
      
      // 额外更新数据库状态
      if (rule && rule.isActive) {
        await this.prisma.trackingRule.update({
          where: { id: ruleId },
          data: { isActive: false }
        });
        console.log(`[TrackingService] 已将规则 ${ruleId} 在数据库中标记为非活跃`);
      }
    } catch (e) {
      console.error(`[TrackingService] 获取或更新规则状态失败:`, e);
    }
  }

  async restartTracking(rule: TrackingRule): Promise<void> {
    console.log(`[TrackingService] 重启规则追踪: ${rule.id} (${rule.name})`);
    // 确保先彻底清理定时器
    this.twitter.stopPolling(rule.id);
    
    if (rule.isActive) {
      await this.startTracking(rule);
    }
  }

  private async shouldPollRule(rule: TrackingRule): Promise<boolean> {
    if (!rule.isActive || !rule.pollingEnabled) {
      console.log(`[TrackingService] 规则 ${rule.id} 未启用或未开启轮询，跳过。`);
      return false;
    }

    // 如果没有设置时间段，使用默认的轮询间隔
    if (!(rule as any).timeSlots || (rule as any).timeSlots.length === 0) {
      const lastPoll = rule.lastPolledAt ? new Date(rule.lastPolledAt) : null;
      if (!lastPoll) {
        return true;
      }
      const shouldPoll = Date.now() - lastPoll.getTime() >= rule.pollingInterval * 1000;
      console.log(`[TrackingService] 规则 ${rule.id} 默认轮询判断:`, shouldPoll);
      return shouldPoll;
    }

    // 检查当前时间是否在任何时间段内
    const now = new Date();
    const currentTime = now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
    for (const slot of (rule as any).timeSlots || []) {
      if (currentTime >= slot.startTime && currentTime <= slot.endTime) {
        const lastPoll = rule.lastPolledAt ? new Date(rule.lastPolledAt) : null;
        if (!lastPoll) {
          return true;
        }
        const shouldPoll = Date.now() - lastPoll.getTime() >= slot.pollingInterval * 1000;
        console.log(`[TrackingService] 规则 ${rule.id} 时间段[${slot.startTime}-${slot.endTime}]轮询判断:`, shouldPoll);
        return shouldPoll;
      }
    }
    console.log(`[TrackingService] 规则 ${rule.id} 当前不在任何时间段内，不轮询。`);
    return false;
  }

  private async updateLastPolledAt(ruleId: string) {
    await this.prisma.trackingRule.update({
      where: { id: ruleId },
      data: { lastPolledAt: new Date() }
    });
  }

  async deleteRule(ruleId: string): Promise<void> {
    console.log(`[TrackingService] 删除规则: ${ruleId}`);
    
    // 获取规则详情，用于日志
    try {
      const rule = await this.prisma.trackingRule.findUnique({
        where: { id: ruleId },
        select: { name: true }
      });
      console.log(`[TrackingService] 删除规则 ${ruleId} (${rule?.name || '未知'})`);
    } catch (e) {
      console.log(`[TrackingService] 获取规则详情失败:`, e);
    }
    
    // 记录当前状态
    const beforeTimers = this.twitter.getActiveRuleIds();
    console.log('[TrackingService] 删除前所有定时器key:', beforeTimers);
    
    // 强制停止所有相关定时器
    const relatedTimers = beforeTimers.filter(id => id === ruleId || id.startsWith(`${ruleId}_`));
    console.log(`[TrackingService] 找到 ${relatedTimers.length} 个相关定时器:`, relatedTimers);
    
    if (relatedTimers.length > 0) {
      console.log(`[TrackingService] 清理所有相关定时器...`);
      for (const timerId of relatedTimers) {
        this.twitter.stopPolling(timerId);
      }
    } else if (this.twitter.isPolling(ruleId)) {
      console.log(`[TrackingService] isPolling 检测到定时器存在，尝试停止`);
      this.twitter.stopPolling(ruleId);
    } else {
      console.log(`[TrackingService] 规则 ${ruleId} 没有活跃定时器，无需停止。`);
    }
    
    // 再次检查，确保真的被清理了
    const afterTimers = this.twitter.getActiveRuleIds();
    const stillExists = afterTimers.some(id => id === ruleId || id.startsWith(`${ruleId}_`));
    if (stillExists) {
      console.warn(`[TrackingService] 警告: 规则 ${ruleId} 相关定时器未能完全清理，仍有:`, 
        afterTimers.filter(id => id === ruleId || id.startsWith(`${ruleId}_`)));
    }
    
    // 数据库级联删除
    try {
      // 1. 查询所有关联推文ID
      const tweets = await this.prisma.tweet.findMany({
        where: { matchedRuleId: ruleId },
        select: { id: true }
      });
      const tweetIds = tweets.map((t: { id: string }) => t.id);
      console.log(`[TrackingService] 找到 ${tweetIds.length} 条相关推文需要删除`);
      
      // 2. 先删除所有关联推文分析
      if (tweetIds.length > 0) {
        await this.prisma.tweetAnalysis.deleteMany({
          where: { tweetId: { in: tweetIds } }
        });
        console.log(`[TrackingService] 已删除所有相关推文分析`);
      }
      
      // 3. 再删除所有关联推文
      const deletedTweets = await this.prisma.tweet.deleteMany({
        where: { matchedRuleId: ruleId }
      });
      console.log(`[TrackingService] 已删除 ${deletedTweets.count} 条相关推文`);
      
      // 4. 最后删除规则
      await this.prisma.trackingRule.delete({
        where: { id: ruleId }
      });
      console.log(`[TrackingService] 规则 ${ruleId} 已成功从数据库删除`);
    } catch (error) {
      console.error(`[TrackingService] 删除规则数据失败:`, error);
      throw error;
    }
  }

  // 清理过期的已通知推文记录
  clearOldNotifiedTweets(maxAgeDays: number = 7): void {
    console.log(`[TrackingService] 清理超过 ${maxAgeDays} 天的已通知推文记录`);
    // 该方法可以在未来实现更复杂的清理逻辑
    // 目前简单实现可以跳过，仅保留接口
  }
  
  // 恢复最近活跃的规则追踪
  async resumeRecentlyActiveRules(hourThreshold: number = 24): Promise<number> {
    console.log(`[TrackingService] 尝试恢复最近 ${hourThreshold} 小时内活跃的规则...`);
    try {
      // 获取所有最近有轮询记录的规则
      const recentlyActiveRules = await this.prisma.trackingRule.findMany({
        where: {
          AND: [
            { lastPolledAt: { not: null } },
            { lastPolledAt: { gt: new Date(Date.now() - hourThreshold * 60 * 60 * 1000) } } // 最近指定小时内有轮询
          ]
        },
        include: { timeSlots: true }
      });
      
      console.log(`[TrackingService] 发现 ${recentlyActiveRules.length} 个最近活跃的规则`);
      let resumedCount = 0;
      
      // 对每个规则进行处理
      for (const rule of recentlyActiveRules) {
        // 如果规则当前未被标记为活跃，更新其状态
        if (!rule.isActive) {
          console.log(`[TrackingService] 恢复规则 ${rule.id} (${rule.name}) 的活跃状态`);
          await this.prisma.trackingRule.update({
            where: { id: rule.id },
            data: { isActive: true }
          });
          // 更新规则对象状态
          rule.isActive = true;
        }
        
        // 检查该规则是否已在轮询中
        const isPolling = this.twitter.isPolling(rule.id);
        if (!isPolling) {
          console.log(`[TrackingService] 启动规则 ${rule.id} (${rule.name}) 的追踪`);
          await this.startTracking(rule);
          resumedCount++;
        } else {
          console.log(`[TrackingService] 规则 ${rule.id} (${rule.name}) 已在轮询中，无需恢复`);
        }
      }
      
      console.log(`[TrackingService] 成功恢复 ${resumedCount} 个规则的追踪`);
      return resumedCount;
    } catch (error) {
      console.error(`[TrackingService] 恢复最近活跃规则失败:`, error);
      return 0;
    }
  }
  
  // 重置通知状态，用于手动触发或解决通知问题
  resetNotificationStatus(ruleId?: string): void {
    if (ruleId) {
      // 如果提供了规则ID，只清除与该规则相关的通知状态
      // 由于通知状态只保存推文ID，无法直接知道哪些推文属于哪个规则
      // 这里实现较为困难，暂不实现
      console.log(`[TrackingService] 需要先查询规则 ${ruleId} 相关的推文，然后才能清除其通知状态`);
    } else {
      // 清空所有通知状态
      this.notifiedTweets.clear();
      console.log(`[TrackingService] 已清空所有通知状态，下次轮询将重新发送通知`);
    }
  }
}

// 创建单例并导出
export const trackingService = TrackingService.getInstance(); 
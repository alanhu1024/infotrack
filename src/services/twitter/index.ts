import { TwitterApi } from 'twitter-api-v2';
import { env } from '@/config/env';
import type { TrackingRule } from '@/types';
import { prisma } from '@/lib/prisma';

// 使用全局对象确保真正的全局单例
declare global {
  var __twitterServiceInstance: TwitterService | null;
}

// 优先从全局对象获取实例
let twitterServiceInstance: TwitterService | null = global.__twitterServiceInstance || null;

export class TwitterService {
  private client: TwitterApi;
  private pollingJobs: Map<string, NodeJS.Timeout>;

  // 私有构造函数，防止直接new
  private constructor() {
    if (twitterServiceInstance) {
      throw new Error('TwitterService 已存在，请使用 TwitterService.getInstance()');
    }
    
    console.log('[TwitterService] 创建新实例 (单例)');
    this.client = new TwitterApi({
      appKey: env.TWITTER_API_KEY,
      appSecret: env.TWITTER_API_SECRET,
      accessToken: env.TWITTER_ACCESS_TOKEN,
      accessSecret: env.TWITTER_ACCESS_SECRET,
    });
    this.pollingJobs = new Map();
  }

  // 获取单例实例的静态方法
  public static getInstance(): TwitterService {
    if (!twitterServiceInstance) {
      twitterServiceInstance = new TwitterService();
      // 保存到全局对象
      global.__twitterServiceInstance = twitterServiceInstance;
    }
    return twitterServiceInstance;
  }

  async getUserTweets(username: string, sinceId?: string): Promise<Array<{
    id: string;
    text: string;
    authorId: string;
    createdAt: Date;
  }>> {
    try {
      const user = await this.client.v2.userByUsername(username);
      if (!user.data) {
        throw new Error(`User ${username} not found`);
      }

      const tweets = await this.client.v2.userTimeline(user.data.id, {
        since_id: sinceId,
        "tweet.fields": ["created_at"],
      });

      const tweetList = tweets.data?.data ?? [];
      return tweetList.map(tweet => ({
        id: tweet.id,
        text: tweet.text,
        authorId: user.data.id,
        createdAt: new Date(tweet.created_at!),
      }));
    } catch (error: any) {
      // 输出详细错误信息
      if (error?.data) {
        console.error('[TwitterService] getUserTweets API错误:', error.data);
      }
      console.error('[TwitterService] getUserTweets 异常:', error);
      throw error;
    }
  }

  async startPolling(rule: TrackingRule, callback: (tweet: {
    id: string;
    text: string;
    authorId: string;
    createdAt: Date;
  }) => Promise<void>): Promise<void> {
    const key = String(rule.id);
    console.log(`[TwitterService] startPolling 请求, key:`, key, typeof key);
    console.log(`[TwitterService] 当前所有定时器key (${this.pollingJobs.size}个):`, Array.from(this.pollingJobs.keys()));
    
    // 在开始前检查规则是否存在并活跃
    try {
      console.log(`[TwitterService] 检查规则 ${key} 状态...`);
      const ruleExists = await prisma.trackingRule.findUnique({
        where: { id: key }
      });
      
      if (!ruleExists || !ruleExists.isActive) {
        console.log(`[TwitterService] 规则 ${key} 已被删除或停用，不启动轮询`);
        // 确保清理所有旧定时器
        this.stopPolling(key);
        return;
      }
    } catch (dbError) {
      console.error(`[TwitterService] 检查规则状态出错:`, dbError);
      // 出错时保守处理，不启动轮询
      return;
    }
    
    // 如果已存在定时器，先停止
    if (this.pollingJobs.has(key)) {
      console.log(`[TwitterService] 规则 ${key} 已有定时器，先清理再重建`);
      this.stopPolling(key);
    }
    
    // 考虑上次轮询时间，避免过于频繁的轮询
    const lastPolledAt = rule.lastPolledAt ? new Date(rule.lastPolledAt) : null;
    const now = new Date();
    const minIntervalMs = Math.max(rule.pollingInterval * 1000 * 0.8, 60000); // 至少间隔原设定的80%或1分钟
    
    if (lastPolledAt && now.getTime() - lastPolledAt.getTime() < minIntervalMs) {
      // 如果距离上次轮询不到最小间隔，延迟启动定时器
      const remainingTime = minIntervalMs - (now.getTime() - lastPolledAt.getTime());
      console.log(`[TwitterService] 距离上次轮询时间过短 (${Math.round((now.getTime() - lastPolledAt.getTime())/1000)}秒)，${Math.round(remainingTime/1000)}秒后再次轮询`);
      
      // 保存规则ID，不直接使用rule对象引用
      const ruleId = rule.id;
      
      // 创建延迟启动的定时器
      const delayTimer = setTimeout(async () => {
        console.log(`[TwitterService] 延迟结束，检查规则 ${ruleId} 状态`);
        
        // 延迟结束后，重新检查规则状态
        try {
          const freshRule = await prisma.trackingRule.findUnique({
            where: { id: ruleId }
          });
          
          if (!freshRule || !freshRule.isActive) {
            console.log(`[TwitterService] 规则 ${ruleId} 已被删除或停用，不启动轮询`);
            return;
          }
          
          console.log(`[TwitterService] 延迟结束，开始启动规则 ${ruleId} 的轮询`);
          // 使用最新的规则数据重启轮询
          this.startPolling(freshRule, callback);
        } catch (e) {
          console.error(`[TwitterService] 检查规则状态出错:`, e);
        }
      }, remainingTime);
      
      // 记录延迟定时器，确保可以被清理
      this.pollingJobs.set(`${key}_delay`, delayTimer);
      return;
    }

    let lastTweetId: string | undefined;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    const pollTweets = async () => {
      console.log(`[TwitterService] 正在轮询规则 ${key} (${rule.twitterUsername}) 的推文...`);
      try {
        // 检查规则是否仍然存在且激活
        try {
          const ruleExists = await prisma.trackingRule.findUnique({
            where: { id: key }
          });
          
          if (!ruleExists || !ruleExists.isActive) {
            console.log(`[TwitterService] 规则 ${key} 已被删除或停用，停止轮询`);
            this.stopPolling(key);
            return;
          }
        } catch (dbError) {
          console.error(`[TwitterService] 检查规则状态出错:`, dbError);
        }

        const tweets = await this.getUserTweets(rule.twitterUsername, lastTweetId);
        
        // 成功获取推文，重置错误计数
        consecutiveErrors = 0;
        
        // 按时间正序处理推文
        const sortedTweets = tweets.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        
        for (const tweet of sortedTweets) {
          await callback(tweet);
          lastTweetId = tweet.id;
        }
      } catch (error: any) {
        if (error?.data) {
          console.error(`[TwitterService] pollTweets API错误:`, error.data);
        }
        console.error(`Error polling tweets for rule ${key}:`, error);
        
        // 计数连续错误
        consecutiveErrors++;
        
        // 处理API限流情况
        if (error?.code === 429 && error?.rateLimit?.reset) {
          // 如果是限流错误，获取限流重置时间
          const resetTime = error.rateLimit.reset * 1000; // 转为毫秒
          const waitTime = Math.max(resetTime - Date.now(), 60000); // 至少等待1分钟
          console.log(`[TwitterService] 检测到Twitter API限流，将在 ${Math.round(waitTime/1000)} 秒后重试`);
          
          // 检查规则是否已被删除
          try {
            const ruleExists = await prisma.trackingRule.findUnique({
              where: { id: key }
            });
            
            if (!ruleExists || !ruleExists.isActive) {
              console.log(`[TwitterService] 规则 ${key} 已被删除或停用，不再重试`);
              this.stopPolling(key);
              return;
            }
          } catch (e) {
            console.error(`[TwitterService] 检查规则状态出错`, e);
          }
          
          // 暂停定时器，设置一次性延迟调用
          this.stopPolling(key);
          // 保存规则ID，不直接使用rule对象引用
          const ruleId = rule.id;
          
          setTimeout(async () => {
            console.log(`[TwitterService] 限流期结束，检查规则 ${ruleId} 状态`);
            
            // 延迟结束后，重新检查规则状态
            try {
              const freshRule = await prisma.trackingRule.findUnique({
                where: { id: ruleId }
              });
              
              if (!freshRule || !freshRule.isActive) {
                console.log(`[TwitterService] 规则 ${ruleId} 已被删除或停用，不重启轮询`);
                return;
              }
              
              console.log(`[TwitterService] 限流期结束，规则 ${ruleId} 仍然活跃，重新启动轮询`);
              // 使用最新的规则数据重启轮询
              this.startPolling(freshRule, callback);
            } catch (e) {
              console.error(`[TwitterService] 检查规则状态出错:`, e);
            }
          }, waitTime);
          return;
        }
        
        // 如果连续错误次数过多，临时增加轮询间隔
        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.log(`[TwitterService] 连续 ${consecutiveErrors} 次错误，临时增加轮询间隔`);
          // 临时将轮询间隔增加一倍
          this.stopPolling(key);
          // 保存规则ID，不直接使用rule对象引用
          const ruleId = rule.id;
          const retryInterval = rule.pollingInterval * 1000 * 2;
          
          setTimeout(async () => {
            console.log(`[TwitterService] 错误冷却期结束，检查规则 ${ruleId} 状态`);
            
            // 延迟结束后，重新检查规则状态
            try {
              const freshRule = await prisma.trackingRule.findUnique({
                where: { id: ruleId }
              });
              
              if (!freshRule || !freshRule.isActive) {
                console.log(`[TwitterService] 规则 ${ruleId} 已被删除或停用，不重启轮询`);
                return;
              }
              
              console.log(`[TwitterService] 恢复正常轮询: ${ruleId}`);
              // 使用最新的规则数据重启轮询
              this.startPolling(freshRule, callback);
            } catch (e) {
              console.error(`[TwitterService] 检查规则状态出错:`, e);
            }
          }, retryInterval);
          return;
        }
      }
    };

    // 立即执行一次
    await pollTweets();

    // 设置定时轮询
    const intervalId = setInterval(pollTweets, rule.pollingInterval * 1000);
    
    // 将intervalId转为字符串，便于日志输出
    const intervalIdStr = intervalId.toString();
    console.log(`[TwitterService] 创建定时器: ruleId=${key}, intervalId=${intervalIdStr}`);
    
    this.pollingJobs.set(key, intervalId);
    console.log(`[TwitterService] 已启动轮询定时器: ${key}, interval=${rule.pollingInterval}s, 当前定时器总数: ${this.pollingJobs.size}`);
  }

  stopPolling(ruleId: string): void {
    const key = String(ruleId);
    console.log(`[TwitterService] stopPolling 请求, key:`, key, typeof key);
    console.log(`[TwitterService] 当前所有定时器key (${this.pollingJobs.size}个):`, Array.from(this.pollingJobs.keys()));
    
    // 查找所有相关定时器（包括主定时器和延迟定时器）
    const allKeys = Array.from(this.pollingJobs.keys());
    const relatedKeys = allKeys.filter(k => k === key || k.startsWith(`${key}_`));
    
    if (relatedKeys.length === 0) {
      console.log(`[TwitterService] 未找到与规则 ${key} 相关的定时器`);
      return;
    }
    
    console.log(`[TwitterService] 找到 ${relatedKeys.length} 个相关定时器:`, relatedKeys);
    
    // 清理所有相关定时器
    for (const timerKey of relatedKeys) {
      const timer = this.pollingJobs.get(timerKey);
      if (timer) {
        const timerIdStr = timer.toString();
        console.log(`[TwitterService] 准备清理定时器: ${timerKey}, intervalId=${timerIdStr}`);
        
        // 先删除Map中的引用，再清理定时器
        this.pollingJobs.delete(timerKey);
        
        // 根据定时器类型选择清理方法
        if (timerKey.includes('_delay')) {
          clearTimeout(timer);
          console.log(`[TwitterService] 已清理延迟定时器: ${timerKey}`);
        } else {
          clearInterval(timer);
          console.log(`[TwitterService] 已清理轮询定时器: ${timerKey}`);
        }
      }
    }
    
    console.log(`[TwitterService] 已清理所有相关定时器, 剩余定时器: ${this.pollingJobs.size}个`);
  }

  isPolling(ruleId: string): boolean {
    const key = String(ruleId);
    // 同时检查主定时器和所有延迟定时器
    const allKeys = Array.from(this.pollingJobs.keys());
    const hasTimer = allKeys.some(k => k === key || k.startsWith(`${key}_`));
    console.log(`[TwitterService] isPolling 检查: ${key}, 结果: ${hasTimer}`);
    return hasTimer;
  }
  
  // 添加一个获取所有活跃规则ID的方法，用于调试
  getActiveRuleIds(): string[] {
    return Array.from(this.pollingJobs.keys());
  }

  // 添加方法清空所有定时器
  clearAllPollingJobs(): void {
    console.log(`[TwitterService] 清空所有定时器 (${this.pollingJobs.size}个)...`);
    
    // 获取所有定时器key
    const allKeys = Array.from(this.pollingJobs.keys());
    
    // 逐个清理
    for (const key of allKeys) {
      this.stopPolling(key);
    }
    
    // 以防万一，直接清空Map
    this.pollingJobs.clear();
    
    console.log(`[TwitterService] 已清空所有定时器, 当前定时器数: ${this.pollingJobs.size}`);
  }
}

// 导出单例实例，确保整个应用只使用这一个实例
export const twitterServiceSingleton = TwitterService.getInstance();
import { TwitterApi } from 'twitter-api-v2';
import { env } from '@/config/env';
import type { TrackingRule } from '@/types';
import { prisma } from '@/lib/prisma';

// 添加一个函数来转换为北京时间
const toBeiJingTime = (date: Date): string => {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '');
};

// 使用全局对象确保真正的全局单例
declare global {
  var __twitterServiceInstance: TwitterService | null;
  // 也将pollingJobs放入全局对象，确保跨请求持久存在
  var __twitterPollingJobs: Map<string, NodeJS.Timeout> | null;
  // 添加全局推文ID追踪，避免重复处理推文
  var __twitterLastTweetIds: Map<string, string> | null;
  // 添加全局已通知推文追踪，避免重复通知
  var __twitterNotifiedTweets: Set<string> | null;
}

// 优先从全局对象获取实例
let twitterServiceInstance: TwitterService | null = global.__twitterServiceInstance || null;

// 同样从全局获取pollingJobs
if (!global.__twitterPollingJobs) {
  global.__twitterPollingJobs = new Map<string, NodeJS.Timeout>();
  console.log('[TwitterService] 创建全局定时器管理Map');
}

// 创建全局的最新推文ID追踪
if (!global.__twitterLastTweetIds) {
  global.__twitterLastTweetIds = new Map<string, string>();
  console.log('[TwitterService] 创建全局最新推文ID追踪Map');
}

// 创建全局的已通知推文集合
if (!global.__twitterNotifiedTweets) {
  global.__twitterNotifiedTweets = new Set<string>();
  console.log('[TwitterService] 创建全局已通知推文追踪Set');
}

export class TwitterService {
  private client: TwitterApi;
  // 使用全局存储的pollingJobs，确保跨请求持久
  private get pollingJobs(): Map<string, NodeJS.Timeout> {
    return global.__twitterPollingJobs as Map<string, NodeJS.Timeout>;
  }
  
  // 使用全局存储的lastTweetIds，确保跨请求和重建定时器后保持状态
  private get lastTweetIds(): Map<string, string> {
    return global.__twitterLastTweetIds as Map<string, string>;
  }
  
  // 使用全局存储的已通知推文集合
  private get notifiedTweets(): Set<string> {
    return global.__twitterNotifiedTweets as Set<string>;
  }

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
    
    // 打印当前定时器状态
    console.log(`[TwitterService] 当前全局定时器Map大小: ${this.pollingJobs.size}, keys:`, 
      Array.from(this.pollingJobs.keys()));
  }

  // 单例获取方法
  public static getInstance(): TwitterService {
    if (!twitterServiceInstance) {
      twitterServiceInstance = new TwitterService();
      global.__twitterServiceInstance = twitterServiceInstance;
      console.log('[TwitterService] 已创建全局单例实例');
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
  }) => Promise<{
    matched: boolean;
    score: number;
    explanation: string;
  } | void>): Promise<void> {
    // 确保规则ID是字符串
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
    if (this.isPolling(key)) {
      console.log(`[TwitterService] 规则 ${key} 已有定时器，先清理再重建`);
      this.stopPolling(key);
    }
    
    // 考虑上次轮询时间，避免过于频繁的轮询
    const lastPolledAt = rule.lastPolledAt ? new Date(rule.lastPolledAt) : null;
    const now = new Date();
    const minIntervalMs = Math.max(rule.pollingInterval * 1000 * 0.8, 60000);
    
    if (lastPolledAt && now.getTime() - lastPolledAt.getTime() < minIntervalMs) {
      // 如果距离上次轮询不到最小间隔，延迟启动定时器
      const remainingTime = minIntervalMs - (now.getTime() - lastPolledAt.getTime());
      console.log(`[TwitterService] 距离上次轮询时间过短 (${Math.round((now.getTime() - lastPolledAt.getTime())/1000)}秒)，${Math.round(remainingTime/1000)}秒后再次轮询`);
      
      // 保存规则ID，不直接使用rule对象引用
      const ruleId = rule.id;
      
      // 确保延迟定时器的KEY格式一致
      const delayKey = `${key}_delay`;
      
      // 创建延迟启动的定时器
      const delayTimer = setTimeout(async () => {
        console.log(`[TwitterService] 延迟结束，检查规则 ${ruleId} 状态`);
        
        // 清除延迟定时器的引用
        this.pollingJobs.delete(delayKey);
        
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
      this.pollingJobs.set(delayKey, delayTimer);
      console.log(`[TwitterService] 已创建延迟定时器: ${delayKey}, ${remainingTime}ms后执行`);
      return;
    }

    // 从全局存储中获取上次处理的推文ID，避免重复处理
    const tweetId = this.lastTweetIds.get(key);
    let lastTweetId: string | undefined = tweetId || undefined;
    
    // 如果全局状态中没有，尝试从数据库获取
    if (!lastTweetId) {
      try {
        const { prisma } = await import('@/lib/prisma');
        const ruleData = await prisma.trackingRule.findUnique({
          where: { id: key },
          select: { lastProcessedTweetId: true }
        });
        
        if (ruleData?.lastProcessedTweetId) {
          lastTweetId = ruleData.lastProcessedTweetId;
          // 将从数据库加载的ID保存到全局状态
          if (typeof lastTweetId === 'string') {
            this.lastTweetIds.set(key, lastTweetId);
            console.log(`[TwitterService] 从数据库加载lastTweetId: ${lastTweetId} 用于规则 ${key}`);
          }
        }
      } catch (dbError) {
        console.error(`[TwitterService] 从数据库加载lastTweetId失败:`, dbError);
      }
    }
    
    console.log(`[TwitterService] 使用已存储的lastTweetId: ${lastTweetId || '无'} 开始轮询`);
    
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    const pollTweets = async () => {
      const currentTime = toBeiJingTime(new Date());
      console.log(`[TwitterService] 正在轮询规则 ${key} (${rule.twitterUsername}) 的推文... [${currentTime}]`);
      
      // 创建一个数组用于记录本次轮询中满足规则的推文
      const matchedTweets: Array<{
        id: string;
        text: string;
        score: number;
        explanation: string;
      }> = [];
      let matchedCount = 0;
      
      try {
        // 检查规则是否仍然存在且激活
        try {
          const ruleExists = await prisma.trackingRule.findUnique({
            where: { id: key }
          });
          
          if (!ruleExists || !ruleExists.isActive) {
            console.log(`[TwitterService] [${currentTime}] 规则 ${key} 已被删除或停用，停止轮询`);
            this.stopPolling(key);
            return;
          }
        } catch (dbError) {
          console.error(`[TwitterService] [${currentTime}] 检查规则状态出错:`, dbError);
        }

        // 调用TwitterAPI获取新推文
        let tweets;
        // 只在lastTweetId为字符串类型时传入
        if (typeof lastTweetId === 'string') {
          tweets = await this.getUserTweets(rule.twitterUsername, lastTweetId);
        } else {
          tweets = await this.getUserTweets(rule.twitterUsername);
        }
        
        // 成功获取推文，重置错误计数
        consecutiveErrors = 0;
        
        // 按时间正序处理推文
        const sortedTweets = tweets.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        
        console.log(`[TwitterService] [${currentTime}] 获取到 ${sortedTweets.length} 条新推文`);
        
        // 创建一个包含回调函数处理结果的版本
        const processWithResult = async (tweet: {
          id: string;
          text: string;
          authorId: string;
          createdAt: Date;
        }) => {
          // 调用原始回调并捕获返回值
          const result = await callback(tweet);
          
          // 如果回调返回了匹配状态为true，说明满足规则
          if (result && result.matched) {
            matchedCount++;
            matchedTweets.push({
              id: tweet.id,
              text: tweet.text,
              score: result.score,
              explanation: result.explanation
            });
            
            // 移除单条推文的即时通知逻辑，改为只在轮询结束后批量通知
            // 仅在此处记录推文信息，不立即通知
          }
          
          // 更新最后处理的推文ID
          lastTweetId = tweet.id;
          // 每处理一条新推文，就更新全局状态
          // tweet.id总是string类型，所以这里不会有类型错误
          this.lastTweetIds.set(key, tweet.id);
          
          // 同时更新数据库中的lastProcessedTweetId字段
          try {
            await prisma.trackingRule.update({
              where: { id: key },
              data: { 
                lastProcessedTweetId: tweet.id 
              }
            });
          } catch (dbError) {
            console.error(`[TwitterService] [${currentTime}] 更新lastProcessedTweetId失败:`, dbError);
          }
        };
        
        // 处理所有推文
        for (const tweet of sortedTweets) {
          await processWithResult(tweet);
        }
        
        // 输出本次轮询结果
        if (matchedCount > 0) {
          const currentTimeNow = toBeiJingTime(new Date());
          console.log(`[TwitterService] 本次轮询发现 ${matchedCount} 条满足规则的推文 [${currentTimeNow}]`);
          
          // 记录匹配的推文，但不标记为通知状态（完全交由TrackingService处理通知）
          console.log(`[TwitterService] 匹配推文已记录，通知操作将由TrackingService处理 [${currentTimeNow}]`);
        
          matchedTweets.forEach((t, i) => {
            console.log(`[TwitterService] 匹配推文 #${i+1} (分数: ${t.score.toFixed(2)}) [${currentTime}]`);
            console.log(`[TwitterService] 内容: ${t.text.substring(0, 100)}${t.text.length > 100 ? '...' : ''} [${currentTime}]`);
            console.log(`[TwitterService] 分析: ${t.explanation.substring(0, 100)}${t.explanation.length > 100 ? '...' : ''} [${currentTime}]`);
          });
        } else if (sortedTweets.length > 0) {
          console.log(`[TwitterService] [${currentTime}] 本次轮询获取了 ${sortedTweets.length} 条推文，但没有满足规则的内容`);
        }
      } catch (error: any) {
        if (error?.data) {
          console.error(`[TwitterService] [${currentTime}] pollTweets API错误:`, error.data);
        }
        console.error(`[TwitterService] [${currentTime}] Error polling tweets for rule ${key}:`, error);
        
        // 计数连续错误
        consecutiveErrors++;
        
        // 处理API限流情况
        if (error?.code === 429 && error?.rateLimit?.reset) {
          // 如果是限流错误，获取限流重置时间
          const resetTime = error.rateLimit.reset * 1000; // 转为毫秒
          const waitTime = Math.max(resetTime - Date.now(), 60000); // 至少等待1分钟
          console.log(`[TwitterService] [${currentTime}] 检测到Twitter API限流，将在 ${Math.round(waitTime/1000)} 秒后重试`);
          
          // 检查规则是否已被删除
          try {
            const ruleExists = await prisma.trackingRule.findUnique({
              where: { id: key }
            });
            
            if (!ruleExists || !ruleExists.isActive) {
              console.log(`[TwitterService] [${currentTime}] 规则 ${key} 已被删除或停用，不再重试`);
              this.stopPolling(key);
              return;
            }
          } catch (e) {
            console.error(`[TwitterService] [${currentTime}] 检查规则状态出错`, e);
          }
          
          // 暂停定时器，设置一次性延迟调用
          this.stopPolling(key);
          // 保存规则ID，不直接使用rule对象引用
          const ruleId = rule.id;
          
          setTimeout(async () => {
            const retryTime = toBeiJingTime(new Date());
            console.log(`[TwitterService] 限流期结束，检查规则 ${ruleId} 状态 [${retryTime}]`);
            
            // 延迟结束后，重新检查规则状态
            try {
              const freshRule = await prisma.trackingRule.findUnique({
                where: { id: ruleId }
              });
              
              if (!freshRule || !freshRule.isActive) {
                console.log(`[TwitterService] 规则 ${ruleId} 已被删除或停用，不重启轮询 [${retryTime}]`);
                return;
              }
              
              console.log(`[TwitterService] 限流期结束，规则 ${ruleId} 仍然活跃，重新启动轮询 [${retryTime}]`);
              // 使用最新的规则数据重启轮询
              this.startPolling(freshRule, callback);
            } catch (e) {
              console.error(`[TwitterService] 检查规则状态出错: ${e} [${retryTime}]`);
            }
          }, waitTime);
          return;
        }
        
        // 如果连续错误次数过多，临时增加轮询间隔
        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.log(`[TwitterService] [${currentTime}] 连续 ${consecutiveErrors} 次错误，临时增加轮询间隔`);
          // 临时将轮询间隔增加一倍
          this.stopPolling(key);
          // 保存规则ID，不直接使用rule对象引用
          const ruleId = rule.id;
          const retryInterval = rule.pollingInterval * 1000 * 2;
          
          setTimeout(async () => {
            const retryTime = toBeiJingTime(new Date());
            console.log(`[TwitterService] 错误冷却期结束，检查规则 ${ruleId} 状态 [${retryTime}]`);
            
            // 延迟结束后，重新检查规则状态
            try {
              const freshRule = await prisma.trackingRule.findUnique({
                where: { id: ruleId }
              });
              
              if (!freshRule || !freshRule.isActive) {
                console.log(`[TwitterService] 规则 ${ruleId} 已被删除或停用，不重启轮询 [${retryTime}]`);
                return;
              }
              
              console.log(`[TwitterService] 恢复正常轮询: ${ruleId} [${retryTime}]`);
              // 使用最新的规则数据重启轮询
              this.startPolling(freshRule, callback);
            } catch (e) {
              console.error(`[TwitterService] 检查规则状态出错: ${e} [${retryTime}]`);
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
    const setupTime = toBeiJingTime(new Date());
    console.log(`[TwitterService] 创建定时器: ruleId=${key}, intervalId=${intervalIdStr} [${setupTime}]`);
    
    // 确保使用正确的key格式存储
    this.pollingJobs.set(key, intervalId);
    
    // 同步更新全局状态
    global.__twitterPollingJobs = this.pollingJobs;
    
    // 更新规则的最后轮询时间
    try {
      await prisma.trackingRule.update({
        where: { id: key },
        data: { lastPolledAt: new Date() }
      });
      console.log(`[TwitterService] 已启动轮询定时器: ${key}, interval=${rule.pollingInterval}s, 当前定时器总数: ${this.pollingJobs.size} [${setupTime}]`);
      console.log(`[TwitterService] 当前所有定时器key: ${Array.from(this.pollingJobs.keys()).join(', ')} [${setupTime}]`);
    } catch (dbError) {
      console.error(`[TwitterService] 更新规则轮询时间失败: ${dbError} [${setupTime}]`);
    }
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
        console.log(`[TwitterService] 准备清理定时器: ${timerKey}, intervalId=${timerIdStr} [${toBeiJingTime(new Date())}]`);
        
        // 先删除Map中的引用，再清理定时器
        this.pollingJobs.delete(timerKey);
        
        // 根据定时器类型选择清理方法
        if (timerKey.includes('_delay')) {
          clearTimeout(timer);
          console.log(`[TwitterService] 已清理延迟定时器: ${timerKey} [${toBeiJingTime(new Date())}]`);
        } else {
          clearInterval(timer);
          console.log(`[TwitterService] 已清理轮询定时器: ${timerKey} [${toBeiJingTime(new Date())}]`);
        }
      }
    }
    
    // 同步更新全局状态
    global.__twitterPollingJobs = this.pollingJobs;
    
    console.log(`[TwitterService] 已清理所有相关定时器, 剩余定时器: ${this.pollingJobs.size}个`);
    console.log(`[TwitterService] 剩余定时器key: ${Array.from(this.pollingJobs.keys()).join(', ')}`);
  }

  isPolling(ruleId: string): boolean {
    const key = String(ruleId);
    // 同时检查主定时器和所有延迟定时器
    const allKeys = Array.from(this.pollingJobs.keys());
    const hasTimer = allKeys.some(k => k === key || k.startsWith(`${key}_`));
    console.log(`[TwitterService] isPolling 检查: ${key}, 结果: ${hasTimer}, 当前所有key: ${allKeys.join(', ')} [${toBeiJingTime(new Date())}]`);
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
      const timer = this.pollingJobs.get(key);
      if (timer) {
        // 根据定时器类型选择清理方法
        if (key.includes('_delay')) {
          clearTimeout(timer);
        } else {
          clearInterval(timer);
        }
        this.pollingJobs.delete(key);
        console.log(`[TwitterService] 已清理定时器: ${key}`);
      }
    }
    
    // 以防万一，直接清空Map
    this.pollingJobs.clear();
    
    // 同步更新全局状态
    global.__twitterPollingJobs = this.pollingJobs;
    
    console.log(`[TwitterService] 已清空所有定时器, 当前定时器数: ${this.pollingJobs.size}`);
  }
  
  // 添加持久化定时器状态到数据库的方法（可选实现）
  async persistTimers(): Promise<void> {
    try {
      console.log(`[TwitterService] 持久化 ${this.pollingJobs.size} 个定时器状态`);
      // 这里可以实现将定时器存储到数据库的逻辑
    } catch (error) {
      console.error('[TwitterService] 持久化定时器状态失败:', error);
    }
  }

  // 清理规则相关的所有状态，只在完全删除规则时调用
  cleanupRule(ruleId: string): void {
    const key = String(ruleId);
    // 停止所有相关定时器
    this.stopPolling(key);
    // 同时清理推文ID追踪
    this.lastTweetIds.delete(key);
    console.log(`[TwitterService] 已完全清理规则 ${key} 的所有状态`);
  }
  
  // 添加清理已通知推文的方法（可选，用于定期清理过旧的记录）
  clearOldNotifiedTweets(maxAgeDays: number = 7): void {
    console.log(`[TwitterService] 清理超过 ${maxAgeDays} 天的已通知推文记录`);
    // 该方法可以在未来实现，清理过旧的通知记录
    // 由于Twitter推文ID是按时间递增的，所以理论上可以根据ID大小判断
    // 目前简单实现可以跳过，仅保留接口
  }
}

// 导出单例实例，确保整个应用只使用这一个实例
export const twitterServiceSingleton = TwitterService.getInstance();
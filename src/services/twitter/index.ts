import { TwitterApi } from 'twitter-api-v2';
import { env } from '@/config/env';
import type { TrackingRule } from '@/types';
import { prisma } from '@/lib/prisma';
import axios from 'axios';
import { ExtendedTwitterApi } from './types';

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

// 定义推文结构
interface Tweet {
  id: string;
  text: string;
  authorId: string;
  createdAt: Date;
}

// 轮询工作Map
// 存储格式: { rule_id: intervalId, rule_id_delay: timeoutId }
type PollingJobsMap = Map<string, NodeJS.Timeout>;

// 添加轮询队列类型，支持轮询完成事件
interface PollingQueueItem {
  tweets: Array<{
    id: string;
    text: string;
    authorId: string;
    score?: number;
    explanation?: string;
  }>;
  processing: boolean;
  onComplete?: (tweets: any[]) => Promise<void>;
}

export class TwitterService {
  private client: ExtendedTwitterApi;
  private pollingJobs: PollingJobsMap;
  private pollingRequestsCount = 0;
  
  // 使用全局存储的lastTweetIds，确保跨请求和重建定时器后保持状态
  private get lastTweetIds(): Map<string, string> {
    return global.__twitterLastTweetIds as Map<string, string>;
  }
  
  // 使用全局存储的已通知推文集合
  private get notifiedTweets(): Set<string> {
    return global.__twitterNotifiedTweets as Set<string>;
  }

  // 添加轮询队列Map
  private pollingQueue: Map<string, PollingQueueItem>;

  constructor() {
    this.pollingJobs = new Map();
    // 初始化轮询队列
    this.pollingQueue = new Map();
    console.log('[TwitterService] 初始化');
    
    if (twitterServiceInstance) {
      throw new Error('TwitterService 已存在，请使用 TwitterService.getInstance()');
    }
    
    console.log('[TwitterService] 创建新实例 (单例)');
    
    // 初始化会在需要时懒加载，不在构造函数中直接创建
    this.client = null as unknown as ExtendedTwitterApi;
    
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

  // 获取活跃的规则ID列表
  public getActiveRuleIds(): string[] {
    return Array.from(this.pollingJobs.keys());
  }

  // 检查规则是否正在轮询
  public isPolling(ruleId: string): boolean {
    return this.pollingJobs.has(ruleId);
  }

  // 清空所有轮询作业
  public clearAllPollingJobs(): void {
    console.log(`[TwitterService] 清空所有定时器 (${this.pollingJobs.size} 个)`);
    for (const [key, timer] of this.pollingJobs.entries()) {
      if (key.endsWith('_delay')) {
        clearTimeout(timer);
      } else {
        clearInterval(timer);
      }
      console.log(`[TwitterService] 清理定时器: ${key}`);
    }
    this.pollingJobs.clear();
  }

  // 初始化Twitter API
  private async initAPI(username: string) {
    // 安全措施，避免每次都创建API实例
    if (this.client) {
      return this.client;
    }

    try {
      // 使用相对路径导入API配置
      const apiConfig = await import('@/services/twitter/api-config');
      this.client = apiConfig.getTwitterModule();
      return this.client;
    } catch (error) {
      console.error('[TwitterService] 初始化Twitter API失败:', error);
      throw error;
    }
  }

  // 获取用户信息，主要用于验证用户存在性
  async fetchUserByUsername(username: string) {
    try {
      const api = await this.initAPI(username);
      // 直接使用API实例，不需要类型断言
      return await api.getUserByUsername(username);
    } catch (error) {
      console.error(`[TwitterService] 获取用户 @${username} 信息失败:`, error);
      throw error;
      }
  }

  // 获取用户最新推文
  async fetchLatestTweets(username: string, count: number = 10, sinceId?: string): Promise<Tweet[]> {
    try {
      const api = await this.initAPI(username);
      console.log(`[TwitterService] 获取 @${username} 的${sinceId ? '新' : '最新'}推文, count=${count}${sinceId ? ', sinceId=' + sinceId : ''}`);
      
      // 记录API请求次数
      this.pollingRequestsCount++;
      
      // 直接使用API实例，不需要类型断言
      const result = await api.getUserTweets(username, count, sinceId);
      console.log(`[TwitterService] 获取到 ${result.length} 条推文，总API请求次数: ${this.pollingRequestsCount}`);
      return result.map((tweet: any) => ({
        id: tweet.id,
        text: tweet.text,
        authorId: tweet.authorId,
        createdAt: new Date(tweet.createdAt)
      }));
    } catch (error) {
      console.error(`[TwitterService] 获取 @${username} 推文失败:`, error);
      return [];
    }
  }

  // 检查推文是否匹配规则的实现
  private async checkTweets(rule: TrackingRule, callback: (tweet: Tweet) => Promise<any>) {
    try {
      // 检查规则存在性
      const ruleExists = await prisma.trackingRule.findUnique({
        where: { id: rule.id },
      });
      
      if (!ruleExists) {
        console.log(`[TwitterService] 规则 ${rule.id} 不存在，停止轮询`);
        this.stopPolling(rule.id);
        return;
      }

      // 获取规则的最后处理推文ID
      let lastProcessedTweetId = rule.lastProcessedTweetId || undefined;

      console.log(`[TwitterService] 检查 @${rule.twitterUsername} 的新推文, 上次处理ID: ${lastProcessedTweetId || '无'}`);

      // 获取最新推文
      const tweets = await this.fetchLatestTweets(
        rule.twitterUsername,
        10,
        lastProcessedTweetId
      );

      if (tweets.length === 0) {
        console.log(`[TwitterService] @${rule.twitterUsername} 没有新推文`);
      return;
    }
    
      // 处理所有获取到的推文
      console.log(`[TwitterService] 处理 ${tweets.length} 条新推文`);
      
      // 按时间从旧到新排序，确保先处理旧推文
      const sortedTweets = tweets.sort((a, b) => 
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      
      // 使用临时变量保存最新的推文ID
      let latestTweetId = lastProcessedTweetId;
        
      // 获取轮询队列项
      const queueItem = this.pollingQueue.get(rule.id);
      console.log(`[TwitterService] 轮询队列状态: ${queueItem ? '存在' : '不存在'}, 匹配推文数: ${queueItem?.tweets.length || 0}`);
      
      // 处理每条推文
      for (const tweet of sortedTweets) {
        console.log(`[TwitterService] 处理推文: ${tweet.id}`);
        
        try {
          // 使用回调处理推文
          const result = await callback(tweet);
          console.log(`[TwitterService] 推文处理结果:`, result ? JSON.stringify({matched: result.matched, score: result.score}) : 'undefined');
          
          // 更新最新处理的推文ID
          if (!latestTweetId || tweet.id > latestTweetId) {
            latestTweetId = tweet.id;
          }
          
          // 如果结果表示匹配，添加到队列
          if (result && result.matched === true && queueItem) {
            console.log(`[TwitterService] 添加匹配推文 ${tweet.id} 到轮询队列`);
            queueItem.tweets.push({
              id: tweet.id,
              text: tweet.text,
              authorId: tweet.authorId,
              score: result.score || 0,
              explanation: result.explanation || ''
            });
          }
        } catch (error) {
          console.error(`[TwitterService] 处理推文 ${tweet.id} 失败:`, error);
        }
      }

      // 获取最新的规则数据
      const freshRule = await prisma.trackingRule.findUnique({
        where: { id: rule.id },
        include: { timeSlots: true }
      });

      if (freshRule && latestTweetId && latestTweetId !== lastProcessedTweetId) {
        console.log(`[TwitterService] 更新规则 ${rule.id} 的最后处理推文ID: ${latestTweetId}`);
          
        // 更新规则的最后处理推文ID
            await prisma.trackingRule.update({
          where: { id: rule.id },
          data: { lastProcessedTweetId: latestTweetId }
            });
      }

      // 轮询完成后，调用回调
      if (queueItem) {
        queueItem.processing = false;
        const matchingTweetCount = queueItem.tweets.length;
        console.log(`[TwitterService] 轮询完成后队列状态: 处理=${queueItem.processing}, 匹配推文=${matchingTweetCount}`);
        
        if (matchingTweetCount > 0 && queueItem.onComplete) {
          console.log(`[TwitterService] 发现 ${matchingTweetCount} 条匹配推文，准备调用完成回调`);
          try {
            // 创建副本避免回调中可能的修改
            const tweetsToProcess = [...queueItem.tweets];
            await queueItem.onComplete(tweetsToProcess);
            console.log(`[TwitterService] 完成回调执行成功`);
            // 清空队列
            queueItem.tweets = [];
          } catch (error) {
            console.error(`[TwitterService] 执行轮询完成回调出错:`, error);
          }
        } else if (matchingTweetCount > 0) {
          console.log(`[TwitterService] 有 ${matchingTweetCount} 条匹配推文，但未设置完成回调`);
        } else {
          console.log(`[TwitterService] 没有匹配推文，不触发回调`);
        }
      }

    } catch (error) {
      console.error(`[TwitterService] 检查推文时出错:`, error);
    }
  }

  // 修改开始轮询方法，支持轮询完成回调
  async startPolling(
    rule: TrackingRule, 
    callback: (tweet: Tweet) => Promise<any>,
    onComplete?: (tweets: any[]) => Promise<void>
  ): Promise<void> {
    try {
      // 验证规则
      console.log(`[TwitterService] 启动规则 ${rule.id} (${rule.name}) 的轮询，间隔: ${rule.pollingInterval}秒`);
      
      // 创建或更新轮询队列
      this.pollingQueue.set(rule.id, {
        tweets: [],
        processing: false,
        onComplete
      });
      
      // 检查用户是否存在
      await this.fetchUserByUsername(rule.twitterUsername)
        .catch(error => {
          console.error(`[TwitterService] 无法获取用户 @${rule.twitterUsername} 信息:`, error);
          throw new Error(`Twitter用户 @${rule.twitterUsername} 不存在或无法访问`);
        });
        
      // 先停止已存在的轮询
      this.stopPolling(rule.id);
          
      // 检查规则存在性
            const ruleExists = await prisma.trackingRule.findUnique({
        where: { id: rule.id },
            });
            
      if (!ruleExists) {
        console.error(`[TwitterService] 规则 ${rule.id} 不存在，无法启动轮询`);
              return;
            }

      // 修改立即检查逻辑，启动处理标志
      console.log(`[TwitterService] 开始首次检查: ${rule.id}`);
      const queueItem = this.pollingQueue.get(rule.id);
      if (queueItem) {
        queueItem.processing = true;
        queueItem.tweets = []; // 清空队列中的推文
      }
      
      // 执行检查并捕获所有推文
      await this.checkTweets(rule, async (tweet) => {
        const result = await callback(tweet);
        
        // 如果结果表示匹配，添加到队列
        if (result && result.matched && queueItem) {
          queueItem.tweets.push({
            id: tweet.id,
            text: tweet.text,
            authorId: tweet.authorId,
            score: result.score,
            explanation: result.explanation
          });
        }
        
        return result;
      });
      
      // 检查完成后，调用完成回调
      if (queueItem) {
        queueItem.processing = false;
        console.log(`[TwitterService] 首次检查完成: ${rule.id}, 匹配推文: ${queueItem.tweets.length} 条`);
        
        // 如果有完成回调且有匹配推文，调用它
        if (queueItem.onComplete && queueItem.tweets.length > 0) {
          try {
            await queueItem.onComplete([...queueItem.tweets]);
            // 调用完成后清空队列
            queueItem.tweets = [];
          } catch (error) {
            console.error(`[TwitterService] 处理轮询完成回调出错:`, error);
          }
        }
      }

      // 设置定期轮询
      console.log(`[TwitterService] 设置 ${rule.pollingInterval}秒 轮询间隔: ${rule.id}`);
      const intervalId = setInterval(async () => {
        console.log(`[TwitterService] 执行定期轮询: ${rule.id}`);
            
        // 获取最新的规则数据
              const freshRule = await prisma.trackingRule.findUnique({
          where: { id: rule.id },
          include: { timeSlots: true }
              });
              
        if (!freshRule) {
          console.log(`[TwitterService] 规则 ${rule.id} 已不存在，停止轮询`);
          this.stopPolling(rule.id);
          return;
        }
        
        if (!freshRule.isActive) {
          console.log(`[TwitterService] 规则 ${rule.id} 已停用，停止轮询`);
          this.stopPolling(rule.id);
          return;
        }

        // 处理类型转换，确保能传给checkTweets方法
        const trackingRule = {
          ...freshRule,
          notificationPhone: freshRule.notificationPhone || undefined
        };
    
        // 修改执行检查部分，处理轮询队列
        const queueItem = this.pollingQueue.get(rule.id);
        if (queueItem) {
          queueItem.processing = true;
          queueItem.tweets = []; // 清空队列中的推文
        }
        
        // 执行检查并捕获所有推文
        await this.checkTweets(trackingRule, async (tweet) => {
          const result = await callback(tweet);
          
          // 如果结果表示匹配，添加到队列
          if (result && result.matched && queueItem) {
            queueItem.tweets.push({
              id: tweet.id,
              text: tweet.text,
              authorId: tweet.authorId,
              score: result.score,
              explanation: result.explanation
            });
          }
          
          return result;
        });
        
        // 检查完成后，调用完成回调
        if (queueItem) {
          queueItem.processing = false;
          console.log(`[TwitterService] 轮询完成: ${rule.id}, 匹配推文: ${queueItem.tweets.length} 条`);
          
          // 如果有完成回调且有匹配推文，调用它
          if (queueItem.onComplete && queueItem.tweets.length > 0) {
            try {
              await queueItem.onComplete([...queueItem.tweets]);
              // 调用完成后清空队列
              queueItem.tweets = [];
            } catch (error) {
              console.error(`[TwitterService] 处理轮询完成回调出错:`, error);
            }
          }
        }
      }, rule.pollingInterval * 1000);

      // 保存轮询作业
      this.pollingJobs.set(rule.id, intervalId);

      console.log(`[TwitterService] 已创建轮询作业: ${rule.id}`);
    } catch (error) {
      console.error(`[TwitterService] 启动轮询失败: ${rule.id}`, error);
      throw error;
    }
  }

  // 修改停止轮询方法，清理轮询队列
  stopPolling(ruleId: string): void {
    console.log(`[TwitterService] 停止规则 ${ruleId} 的轮询`);

    // 清理定时器
    const intervalId = this.pollingJobs.get(ruleId);
    if (intervalId) {
      clearInterval(intervalId);
      this.pollingJobs.delete(ruleId);
      console.log(`[TwitterService] 已移除轮询作业: ${ruleId}`);
    }

    // 清理延迟任务
    const delayKey = `${ruleId}_delay`;
    const delayId = this.pollingJobs.get(delayKey);
    if (delayId) {
      clearTimeout(delayId);
      this.pollingJobs.delete(delayKey);
      console.log(`[TwitterService] 已移除延迟任务: ${delayKey}`);
    }

    // 清理轮询队列
    if (this.pollingQueue.has(ruleId)) {
      this.pollingQueue.delete(ruleId);
      console.log(`[TwitterService] 已移除轮询队列: ${ruleId}`);
    }
  }

  // 重启轮询
  async restartPolling(
    rule: TrackingRule, 
    callback: (tweet: Tweet) => Promise<any>,
    onComplete?: (tweets: any[]) => Promise<void>
  ): Promise<void> {
    // 先停止轮询
    this.stopPolling(rule.id);
    
    // 检查规则是否存在
    const ruleExists = await prisma.trackingRule.findUnique({
      where: { id: rule.id },
    });
    
    if (!ruleExists) {
      console.log(`[TwitterService] 规则 ${rule.id} 不存在，跳过重启`);
      return;
    }
    
    // 如果规则不活跃，直接返回
    if (!rule.isActive) {
      console.log(`[TwitterService] 规则 ${rule.id} 未启用，跳过重启`);
      return;
    }
    
    console.log(`[TwitterService] 重启规则 ${rule.id} 的轮询`);
    
    // 检查时间条件 - 使用北京时间
    const now = new Date();
    const beijingNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const currentHour = beijingNow.getHours();
    const currentMinute = beijingNow.getMinutes();
    const currentTimeString = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
    console.log(`[TwitterService] 当前北京时间: ${currentTimeString}`);
    
    // 如果有时间槽配置
    if (rule.timeSlots && rule.timeSlots.length > 0) {
      console.log(`[TwitterService] 规则 ${rule.id} 有 ${rule.timeSlots.length} 个时间段配置`);
        
      // 检查当前时间是否在任何时间槽内
      const isInAnyTimeSlot = rule.timeSlots.some(slot => {
        return currentTimeString >= slot.startTime && currentTimeString <= slot.endTime;
      });
      
      if (isInAnyTimeSlot) {
        console.log(`[TwitterService] 当前时间 ${currentTimeString} 在规则 ${rule.id} 的时间段内，启动轮询`);
        
        // 获取最新规则数据
        const freshRule = await prisma.trackingRule.findUnique({
          where: { id: rule.id },
          include: { timeSlots: true }
        });
        
        if (freshRule) {
          // 处理类型转换
          const trackingRule = {
            ...freshRule,
            notificationPhone: freshRule.notificationPhone || undefined
          };
          this.startPolling(trackingRule, callback, onComplete);
        }
        } else {
        console.log(`[TwitterService] 当前时间 ${currentTimeString} 不在规则 ${rule.id} 的任何时间段内，跳过启动`);
        
        // 计算下一个时间槽的开始时间，安排延迟启动
        const nextSlot = this.findNextTimeSlot(rule.timeSlots, currentTimeString);
        if (nextSlot) {
          const delayMs = this.calculateDelayToTime(nextSlot.startTime);
          console.log(`[TwitterService] 安排在 ${nextSlot.startTime} (${delayMs/1000}秒后) 启动规则 ${rule.id} 的轮询`);
          
          // 创建延迟任务
          const delayKey = `${rule.id}_delay`;
          const existingDelay = this.pollingJobs.get(delayKey);
          if (existingDelay) {
            clearTimeout(existingDelay);
          }
          
          const delayId = setTimeout(async () => {
            console.log(`[TwitterService] 执行延迟启动: ${rule.id}`);
            this.pollingJobs.delete(delayKey);
            
            // 获取最新规则数据
            const freshRule = await prisma.trackingRule.findUnique({
              where: { id: rule.id },
              include: { timeSlots: true }
            });
            
            if (freshRule && freshRule.isActive) {
              // 处理类型转换
              const trackingRule = {
                ...freshRule,
                notificationPhone: freshRule.notificationPhone || undefined
              };
              this.startPolling(trackingRule, callback, onComplete);
            }
          }, delayMs);
          
          this.pollingJobs.set(delayKey, delayId);
        }
      }
    } else {
      console.log(`[TwitterService] 规则 ${rule.id} 没有时间段配置，直接启动轮询`);
      this.startPolling(rule, callback, onComplete);
    }
  }

  // 找到下一个时间槽
  private findNextTimeSlot(timeSlots: any[], currentTime: string): any {
    // 按开始时间排序
    const sortedSlots = [...timeSlots].sort((a, b) => a.startTime.localeCompare(b.startTime));
    
    // 找到下一个开始时间大于当前时间的槽
    const nextSlot = sortedSlots.find(slot => slot.startTime > currentTime);
    
    // 如果找到了，返回；否则返回第一个（明天的）
    return nextSlot || sortedSlots[0];
  }

  // 计算到指定时间的延迟毫秒数
  private calculateDelayToTime(timeString: string): number {
    const [hours, minutes] = timeString.split(':').map(Number);
    // 创建当前北京时间
    const now = new Date();
    const beijingNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    
    // 创建目标北京时间
    const target = new Date(beijingNow);
    target.setHours(hours, minutes, 0, 0);
    
    // 如果目标时间已经过去，设置为明天
    if (target <= beijingNow) {
      target.setDate(target.getDate() + 1);
    }
    
    // 计算毫秒差值（需要转回UTC时间差）
    const beijingDelay = target.getTime() - beijingNow.getTime();
    console.log(`[TwitterService] 计划在北京时间 ${hours}:${minutes.toString().padStart(2, '0')} 执行，延迟 ${beijingDelay/1000} 秒`);
    
    return beijingDelay;
  }

  // 获取已保存的定时器信息
  getTimerInfo(ruleId: string): { intervalId: NodeJS.Timeout | undefined, delayId: NodeJS.Timeout | undefined } {
    return {
      intervalId: this.pollingJobs.get(ruleId),
      delayId: this.pollingJobs.get(`${ruleId}_delay`),
    };
  }
  
  // 更新规则的最后轮询时间
  async updateLastPolledAt(ruleId: string): Promise<void> {
    try {
      // 更新数据库中的最后轮询时间
      await prisma.trackingRule.update({
        where: { id: ruleId },
        data: { lastPolledAt: new Date() }
      });
    } catch (error) {
      console.error(`[TwitterService] 更新最后轮询时间失败: ${ruleId}`, error);
    }
  }
}

// 导出单例实例，确保整个应用只使用这一个实例
export const twitterServiceSingleton = TwitterService.getInstance();
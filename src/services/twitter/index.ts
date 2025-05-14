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

// 导出toBeiJingTime函数供其他模块使用
export { toBeiJingTime };

// 检查文件中是否已有类似方法，如果没有才添加
export function analyzeRateLimitInfo(error: any) {
  // 确保TwitterService实例存在
  const service = TwitterService.getInstance();
  
  if (!error || !error.headers) {
    console.log(`[TwitterService ${toBeiJingTime(new Date())}] 无法解析限流信息：缺少响应头信息`);
    return;
  }
  
  // 从响应头解析限流信息
  const headers = error.headers;
  const limit = headers['x-rate-limit-limit'];
  const remaining = headers['x-rate-limit-remaining'];
  const resetTimestamp = headers['x-rate-limit-reset'];
  const userLimit24h = headers['x-user-limit-24hour-limit'];
  const userRemaining24h = headers['x-user-limit-24hour-remaining'];
  const userReset24h = headers['x-user-limit-24hour-reset'];
  
  // 计算重置时间（北京时间）
  const now = Math.floor(Date.now() / 1000);
  const waitSeconds = resetTimestamp ? Math.max(0, resetTimestamp - now) : 0;
  const resetTime = new Date(resetTimestamp * 1000);
  const resetTimeStr = resetTime.toLocaleString();
  
  // 计算24小时限制的重置时间
  const reset24hTime = userReset24h ? new Date(userReset24h * 1000) : null;
  const reset24hTimeStr = reset24hTime ? reset24hTime.toLocaleString() : '未知';
  
  // 计算人类易读的等待时间
  let waitTimeDisplay = '';
  if (waitSeconds > 3600) {
    const hours = Math.floor(waitSeconds / 3600);
    const minutes = Math.floor((waitSeconds % 3600) / 60);
    waitTimeDisplay = `${hours}小时${minutes}分钟`;
  } else if (waitSeconds > 60) {
    const minutes = Math.floor(waitSeconds / 60);
    const seconds = waitSeconds % 60;
    waitTimeDisplay = `${minutes}分钟${seconds}秒`;
  } else {
    waitTimeDisplay = `${waitSeconds}秒`;
  }
  
  // 构建并显示详细的限流信息
  console.log(`[TwitterService ${toBeiJingTime(new Date())}] ======== Twitter API限流分析 ========`);
  console.log(`[TwitterService ${toBeiJingTime(new Date())}] 15分钟周期限制: ${limit || '未知'}`);
  console.log(`[TwitterService ${toBeiJingTime(new Date())}] 15分钟周期剩余: ${remaining || '0'}`);
  console.log(`[TwitterService ${toBeiJingTime(new Date())}] 15分钟限制重置时间: ${resetTimeStr} (${waitSeconds}秒后 / ${waitTimeDisplay})`);
  console.log(`[TwitterService ${toBeiJingTime(new Date())}] 24小时周期限制: ${userLimit24h || '未知'}`);
  console.log(`[TwitterService ${toBeiJingTime(new Date())}] 24小时周期剩余: ${userRemaining24h || '未知'}`);
  console.log(`[TwitterService ${toBeiJingTime(new Date())}] 24小时限制重置时间: ${reset24hTimeStr}`);
  console.log(`[TwitterService ${toBeiJingTime(new Date())}] ======================================`);
  
  // 更新TwitterService的全局限流状态
  if (service && resetTimestamp) {
    // 使用服务已有的updateRateLimitResetTime方法
    service.updateRateLimitResetTime('default', parseInt(resetTimestamp));
    console.log(`[TwitterService ${toBeiJingTime(new Date())}] 已更新全局API限流状态，将在 ${resetTimeStr} 解除限流，需要等待 ${waitTimeDisplay}`);
  }
  
  // 如果24小时限额已用完，也更新相应的限流状态
  if (service && userRemaining24h && parseInt(userRemaining24h) <= 0 && userReset24h) {
    service.updateRateLimitResetTime('24hour', parseInt(userReset24h));
    console.log(`[TwitterService ${toBeiJingTime(new Date())}] 已更新24小时API限流状态，将在 ${reset24hTimeStr} 解除限流`);
  }
}

// 使用全局对象确保真正的全局单例
declare global {
  var __twitterServiceInstance: TwitterService | null;
  // 也将pollingJobs放入全局对象，确保跨请求持久存在
  var __twitterPollingJobs: Map<string, NodeJS.Timeout> | null;
  // 添加全局推文ID追踪，避免重复处理推文
  var __twitterLastTweetIds: Map<string, string> | null;
  // 添加全局已通知推文追踪，避免重复通知
  var __twitterNotifiedTweets: Set<string> | null;
  // 添加全局轮询时间追踪，避免在周期内重复轮询
  var __twitterLastPollingTimes: Map<string, number> | null;
  // 添加全局API限流重置时间追踪，用于动态调整轮询
  var __twitterRateLimitResetTimes: Map<string, number> | null;
}

// 优先从全局对象获取实例
let twitterServiceInstance: TwitterService | null = global.__twitterServiceInstance || null;

// 同样从全局获取pollingJobs
if (!global.__twitterPollingJobs) {
  global.__twitterPollingJobs = new Map<string, NodeJS.Timeout>();
  console.log(`[TwitterService ${toBeiJingTime(new Date())}] 创建全局定时器管理Map`);
}

// 创建全局的最新推文ID追踪
if (!global.__twitterLastTweetIds) {
  global.__twitterLastTweetIds = new Map<string, string>();
  console.log(`[TwitterService ${toBeiJingTime(new Date())}] 创建全局最新推文ID追踪Map`);
}

// 创建全局的已通知推文集合
if (!global.__twitterNotifiedTweets) {
  global.__twitterNotifiedTweets = new Set<string>();
  console.log(`[TwitterService ${toBeiJingTime(new Date())}] 创建全局已通知推文追踪Set`);
}

// 创建全局的轮询时间追踪
if (!global.__twitterLastPollingTimes) {
  global.__twitterLastPollingTimes = new Map<string, number>();
  console.log(`[TwitterService ${toBeiJingTime(new Date())}] 创建全局轮询时间追踪Map`);
}

// 创建全局的API限流重置时间追踪
if (!global.__twitterRateLimitResetTimes) {
  global.__twitterRateLimitResetTimes = new Map<string, number>();
  console.log(`[TwitterService ${toBeiJingTime(new Date())}] 创建全局API限流重置时间追踪Map`);
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
  
  // 添加访问轮询时间的getter
  private get lastPollingTimes(): Map<string, number> {
    return global.__twitterLastPollingTimes as Map<string, number>;
  }
  
  // 添加访问API限流重置时间的getter
  private get rateLimitResetTimes(): Map<string, number> {
    return global.__twitterRateLimitResetTimes as Map<string, number>;
  }

  // 添加轮询队列Map
  private pollingQueue: Map<string, PollingQueueItem>;

  constructor() {
    // 使用全局对象的pollingJobs，确保在所有请求中共享
    this.pollingJobs = global.__twitterPollingJobs as Map<string, NodeJS.Timeout>;
    // 初始化轮询队列
    this.pollingQueue = new Map();
    console.log(`[TwitterService ${toBeiJingTime(new Date())}] 初始化`);
    
    if (twitterServiceInstance) {
      throw new Error('TwitterService 已存在，请使用 TwitterService.getInstance()');
    }
    
    console.log(`[TwitterService ${toBeiJingTime(new Date())}] 创建新实例 (单例)`);
    
    // 初始化会在需要时懒加载，不在构造函数中直接创建
    this.client = null as unknown as ExtendedTwitterApi;
    
    // 打印当前定时器状态
    console.log(`[TwitterService ${toBeiJingTime(new Date())}] 当前全局定时器Map大小: ${this.pollingJobs.size}, keys:`, 
      Array.from(this.pollingJobs.keys()));
  }

  // 单例获取方法
  public static getInstance(): TwitterService {
    if (!twitterServiceInstance) {
      twitterServiceInstance = new TwitterService();
      global.__twitterServiceInstance = twitterServiceInstance;
      console.log(`[TwitterService ${toBeiJingTime(new Date())}] 已创建全局单例实例`);
    }
    return twitterServiceInstance;
  }

  // 获取活跃的规则ID列表，排除特殊键如 _delay, _checking 等
  public getActiveRuleIds(): string[] {
    const allKeys = Array.from(this.pollingJobs.keys());
    const specialSuffixes = ['_delay', '_checking', '_processing'];
    
    // 过滤出真正的规则ID（不包含特殊后缀的键）
    return allKeys.filter(key => !specialSuffixes.some(suffix => key.endsWith(suffix)));
  }

  // 检查规则是否正在轮询
  public isPolling(ruleId: string): boolean {
    return this.pollingJobs.has(ruleId);
  }

  // 清理所有轮询作业
  public clearAllPollingJobs(): void {
    console.log(`[TwitterService ${toBeiJingTime(new Date())}] 开始清理所有轮询作业...`);
    
    // 获取全局Map
    const globalPollingJobs = global.__twitterPollingJobs as Map<string, NodeJS.Timeout>;
    
    // 1. 清理全局Map中的所有定时器
    for (const [key, timer] of globalPollingJobs.entries()) {
      try {
        if (key.includes('_delay')) {
          clearTimeout(timer);
        } else {
          clearInterval(timer);
        }
        globalPollingJobs.delete(key);
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] 已清理全局定时器: ${key}`);
      } catch (error) {
        console.error(`[TwitterService ${toBeiJingTime(new Date())}] 清理全局定时器 ${key} 失败:`, error);
      }
    }
    
    // 2. 清理实例Map中的所有定时器
    for (const [key, timer] of this.pollingJobs.entries()) {
      try {
        if (key.includes('_delay')) {
          clearTimeout(timer);
        } else {
          clearInterval(timer);
        }
        this.pollingJobs.delete(key);
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] 已清理实例定时器: ${key}`);
      } catch (error) {
        console.error(`[TwitterService ${toBeiJingTime(new Date())}] 清理实例定时器 ${key} 失败:`, error);
      }
    }
    
    console.log(`[TwitterService ${toBeiJingTime(new Date())}] 所有轮询作业已清理完毕`);
  }

  // 强制清理所有轮询定时器，包括特定规则和全局定时器
  public forceCleanupPolling(ruleId?: string): void {
    if (ruleId) {
      console.log(`[TwitterService ${toBeiJingTime(new Date())}] 强制清理规则 ${ruleId} 的所有定时器`);
      // 先尝试正常停止
      this.stopPolling(ruleId);
      
      // 额外清理可能的遗留引用
      const keyPatterns = [
        ruleId,                  // 主定时器
        `${ruleId}_delay`,       // 延迟定时器
        `${ruleId}_checking`,    // 检查中标志
        `${ruleId}_processing`   // 处理中标志
      ];
      
      // 检查所有可能的键模式
      for (const pattern of keyPatterns) {
        // 清理全局Map
        const globalPollingJobs = global.__twitterPollingJobs as Map<string, NodeJS.Timeout>;
        for (const [key, timer] of globalPollingJobs.entries()) {
          if (key.includes(pattern)) {
            if (key.includes('_delay')) {
              clearTimeout(timer);
            } else {
              clearInterval(timer);
            }
            globalPollingJobs.delete(key);
            console.log(`[TwitterService ${toBeiJingTime(new Date())}] 已清理全局定时器: ${key}`);
          }
        }
        
        // 清理实例Map
        for (const [key, timer] of this.pollingJobs.entries()) {
          if (key.includes(pattern)) {
            if (key.includes('_delay')) {
              clearTimeout(timer);
            } else {
              clearInterval(timer);
            }
            this.pollingJobs.delete(key);
            console.log(`[TwitterService ${toBeiJingTime(new Date())}] 已清理实例定时器: ${key}`);
          }
        }
      }
    } else {
      // 没有指定规则ID，清理所有定时器
      console.log(`[TwitterService ${toBeiJingTime(new Date())}] 强制清理所有定时器`);
      this.clearAllPollingJobs();
    }
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
    } catch (error: any) {
      console.error(`[TwitterService ${toBeiJingTime(new Date())}] 初始化Twitter API失败:`, error.message || '未知错误');
      
      // 分析并记录限流信息
      analyzeRateLimitInfo(error);
      
      throw error;
    }
  }

  // 获取用户信息，主要用于验证用户存在性
  async fetchUserByUsername(username: string) {
    try {
      console.log(`[TwitterService ${toBeiJingTime(new Date())}] 获取用户 @${username} 信息...`);
      
      // 记录API请求次数
      this.pollingRequestsCount++;
      
      const api = await this.initAPI(username);
      const user = await api.getUserByUsername(username);
      
      // 只有在成功获取用户信息时才打印包含ID的日志
      if (user && user.id) {
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] 成功获取用户信息: @${username}(${user.id}), 总API请求次数: ${this.pollingRequestsCount}`);
      } else {
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] 成功获取用户信息: @${username}, 总API请求次数: ${this.pollingRequestsCount}`);
      }
      
      return user;
    } catch (error: any) {
      // 专门处理429错误，当遇到限流错误时
      if (error.code === 429 || (error.data && error.data.status === 429)) {
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] 获取用户 @${username} 时遇到Twitter API限流(429)，解析限流信息`);
        
        // 使用限流信息分析工具
        analyzeRateLimitInfo(error);
        
        // 对于429错误，我们记录但不抛出异常，返回null表示暂时无法获取
        return null;
      }
      
      // 针对用户不存在的错误（错误代码50或63）
      if (error.code === 50 || error.code === 63 || (error.data && (error.data.status === 50 || error.data.status === 63))) {
        console.error(`[TwitterService ${toBeiJingTime(new Date())}] 用户 @${username} 不存在或已被删除`);
        throw new Error(`Twitter用户 @${username} 不存在或无法访问: ${error.message || '用户不存在'}`);
      }
      
      // 对于其他错误，记录详情但不中断应用
      console.error(`[TwitterService ${toBeiJingTime(new Date())}] 获取用户 @${username} 信息时遇到其他错误:`, error);
      
      // 判断是否包含其他可能的限流信息
      if (error.headers && (error.headers['x-rate-limit-limit'] || error.headers['x-rate-limit-remaining'])) {
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] 在非429错误中检测到限流相关信息，尝试解析`);
        analyzeRateLimitInfo(error);
      }
      
      // 返回null表示暂时无法获取，但不抛出致命错误
      return null;
    }
  }

  // 获取用户最新推文
  async fetchLatestTweets(username: string, count: number = 10, sinceId?: string): Promise<Tweet[]> {
    try {
      const api = await this.initAPI(username);
      console.log(`[TwitterService ${toBeiJingTime(new Date())}] 获取 @${username} 的${sinceId ? '新' : '最新'}推文, count=${count}${sinceId ? ', sinceId=' + sinceId : ''}`);
      
      // 记录API请求次数
      this.pollingRequestsCount++;
      
      // 检查是否当前已处于API限流状态
      const rateLimitStatus = this.getRateLimitStatus();
      if (rateLimitStatus.isLimited) {
        // 如果已经处于限流状态，输出有用的信息并直接返回空数组
        const resetTime = new Date(rateLimitStatus.resetTime! * 1000);
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] Twitter API当前处于限流状态，将在 ${resetTime.toLocaleString()} (${rateLimitStatus.waitSeconds}秒后) 解除，跳过API调用`);
        return [];
      }
      
      // 直接使用API实例，不需要类型断言
      const result = await api.getUserTweets(username, count, sinceId);
      console.log(`[TwitterService ${toBeiJingTime(new Date())}] 获取到 ${result.length} 条推文，总API请求次数: ${this.pollingRequestsCount}`);
      return result.map((tweet: any) => ({
        id: tweet.id,
        text: tweet.text,
        authorId: tweet.authorId,
        createdAt: new Date(tweet.createdAt)
      }));
    } catch (error: any) {
      console.error(`[TwitterService ${toBeiJingTime(new Date())}] 获取 @${username} 推文失败:`, error.message || '未知错误');
      
      // 添加错误详情分析，特别是对于429错误
      if (error.code === 429 || (error.data && error.data.status === 429)) {
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] 获取推文时遇到限流错误(429)，分析限流信息:`);
        analyzeRateLimitInfo(error);
      } else if (error.headers && (error.headers['x-rate-limit-limit'] || error.headers['x-rate-limit-remaining'])) {
        // 检查非429错误中是否有限流信息
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] 在获取推文错误中检测到限流信息，进行分析:`);
        analyzeRateLimitInfo(error);
      }
      
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
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] 规则 ${rule.id} 不存在，停止轮询`);
        this.stopPolling(rule.id);
        return;
      }

      // 获取规则的最后处理推文ID
      let lastProcessedTweetId = rule.lastProcessedTweetId || undefined;

      console.log(`[TwitterService ${toBeiJingTime(new Date())}] 检查 @${rule.twitterUsername} 的新推文, 上次处理ID: ${lastProcessedTweetId || '无'}`);

      // 检查是否当前已处于API限流状态
      const rateLimitStatus = this.getRateLimitStatus();
      if (rateLimitStatus.isLimited) {
        // 如果已经处于限流状态，输出有用的信息并直接返回
        const resetTime = new Date(rateLimitStatus.resetTime! * 1000);
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] Twitter API当前处于限流状态，将在 ${resetTime.toLocaleString()} (${rateLimitStatus.waitSeconds}秒后) 解除，跳过推文检查`);
        return;
      }

      // 获取最新推文
      let tweets: Tweet[] = [];
      try {
        tweets = await this.fetchLatestTweets(
          rule.twitterUsername,
          10,
          lastProcessedTweetId
        );
      } catch (error: any) {
        console.error(`[TwitterService ${toBeiJingTime(new Date())}] 获取推文失败:`, error.message || '未知错误');
        
        // 分析是否涉及限流
        if (error.code === 429 || (error.data && error.data.status === 429)) {
          console.log(`[TwitterService ${toBeiJingTime(new Date())}] 检查推文时遇到限流错误(429)，分析限流信息`);
          analyzeRateLimitInfo(error);
        }
        
        return; // 直接返回，避免处理空推文列表
      }

      if (tweets.length === 0) {
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] @${rule.twitterUsername} 没有新推文`);
        return;
      }
    
      // 处理所有获取到的推文
      console.log(`[TwitterService ${toBeiJingTime(new Date())}] 处理 ${tweets.length} 条新推文`);
      
      // 按时间从旧到新排序，确保先处理旧推文
      const sortedTweets = tweets.sort((a, b) => 
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      
      // 使用临时变量保存最新的推文ID
      let latestTweetId = lastProcessedTweetId;
      
      // 处理每条推文
      for (const tweet of sortedTweets) {
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] 处理推文: ${tweet.id}`);
        
        try {
          // 使用回调处理推文
          const result = await callback(tweet);
          console.log(`[TwitterService ${toBeiJingTime(new Date())}] 推文处理结果:`, result ? JSON.stringify({matched: result.matched, score: result.score}) : 'undefined');
          
          // 更新最新处理的推文ID
          if (!latestTweetId || tweet.id > latestTweetId) {
            latestTweetId = tweet.id;
          }
        } catch (error: any) {
          console.error(`[TwitterService ${toBeiJingTime(new Date())}] 处理推文 ${tweet.id} 失败:`, error.message || '未知错误');
          analyzeRateLimitInfo(error);
        }
      }

      // 获取最新的规则数据
      const freshRule = await prisma.trackingRule.findUnique({
        where: { id: rule.id },
        include: { timeSlots: true }
      });

      if (freshRule && latestTweetId && latestTweetId !== lastProcessedTweetId) {
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] 更新规则 ${rule.id} 的最后处理推文ID: ${latestTweetId}`);
          
        // 更新规则的最后处理推文ID
        await prisma.trackingRule.update({
          where: { id: rule.id },
          data: { lastProcessedTweetId: latestTweetId }
        });
      }

    } catch (error: any) {
      console.error(`[TwitterService ${toBeiJingTime(new Date())}] 检查推文时出错:`, error.message || '未知错误');
      analyzeRateLimitInfo(error);
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
      console.log(`[TwitterService ${toBeiJingTime(new Date())}] 启动规则 ${rule.id} (${rule.name}) 的轮询，间隔: ${rule.pollingInterval}秒`);
      
      // 先检查是否应该进行轮询
      if (!this.shouldPollNow(rule.id, rule.pollingInterval)) {
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] 规则 ${rule.id} 轮询间隔未到，跳过本次轮询`);
        
        // 如果当前轮询仍然活跃，直接返回，不要重新创建
        if (this.isPolling(rule.id)) {
          console.log(`[TwitterService ${toBeiJingTime(new Date())}] 规则 ${rule.id} 已有活跃轮询，使用现有轮询`);
          return;
        }
        // 否则继续，因为可能需要重新创建轮询（如服务重启后）
      }
      
      // 确保在检查条件前已创建轮询队列
      if (!this.pollingQueue.has(rule.id)) {
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] 创建轮询队列: ${rule.id}`);
        this.pollingQueue.set(rule.id, {
          tweets: [],
          processing: false,
          onComplete
        });
      } else {
        // 更新已存在的队列项的回调函数
        const existingQueue = this.pollingQueue.get(rule.id);
        if (existingQueue) {
          console.log(`[TwitterService ${toBeiJingTime(new Date())}] 更新已存在的轮询队列回调: ${rule.id}`);
          existingQueue.onComplete = onComplete;
        }
      }
      
      // 检查是否存在全局限流状态
      const rateLimitStatus = this.getRateLimitStatus();
      if (rateLimitStatus.isLimited) {
        const waitTimeStr = new Date(rateLimitStatus.resetTime! * 1000).toLocaleString();
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] Twitter API当前处于限流状态，将在 ${waitTimeStr} 解除，跳过用户检查`);
        
        // 即使API限流中，也继续设置轮询定时器（但不立即执行API调用）
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] 虽然API限流中，但仍将设置轮询定时器`);
      } else {
        // 检查用户是否存在
        let userExists = false;
        try {
          const userInfo = await this.fetchUserByUsername(rule.twitterUsername);
          // 检查userInfo是否为null（可能因为限流而返回null）
          if (userInfo === null) {
            console.log(`[TwitterService ${toBeiJingTime(new Date())}] 无法获取用户信息，但将继续设置轮询定时器`);
            // 记录到全局限流状态，确保其他组件知道当前状态
            if (this.getRateLimitStatus().isLimited) {
              console.log(`[TwitterService ${toBeiJingTime(new Date())}] 检测到API处于限流状态，将在 ${new Date(this.getRateLimitStatus().resetTime! * 1000).toLocaleString()} 解除`);
            }
          } else {
            // 用户存在
            userExists = true;
          }
        } catch (error: any) {
          // 处理429错误（限流）
          if (error.code === 429 || (error.data && error.data.status === 429)) {
            console.log(`[TwitterService ${toBeiJingTime(new Date())}] ===== 检测到Twitter API限流错误(429) =====`);
            
            // 分析并处理限流信息
            analyzeRateLimitInfo(error);
            
            console.log(`[TwitterService ${toBeiJingTime(new Date())}] 虽然API限流中，但仍将继续设置轮询定时器`);
            // 不抛出异常，继续设置轮询定时器
          } else {
            // 对于其他错误，需要判断错误类型
            console.error(`[TwitterService ${toBeiJingTime(new Date())}] 获取用户 @${rule.twitterUsername} 信息时出现非限流错误:`, error.message || '未知错误');
            
            // 如果是用户不存在或无法访问，才抛出中断异常
            if (error.code === 50 || error.code === 63) {
              throw new Error(`Twitter用户 @${rule.twitterUsername} 不存在或无法访问: ${error.message}`);
            } else {
              // 对于其他类型错误，记录但继续设置轮询
              console.log(`[TwitterService ${toBeiJingTime(new Date())}] 非致命错误，继续设置轮询定时器`);
            }
          }
        }

        // 如果用户存在，打印确认日志
        if (userExists) {
          console.log(`[TwitterService ${toBeiJingTime(new Date())}] 成功获取到用户 @${rule.twitterUsername} 信息`);
        }
      }
        
      // 先停止已存在的轮询（但保留队列）
      this.stopPolling(rule.id, true);
          
      // 检查规则存在性
      const ruleExists = await prisma.trackingRule.findUnique({
        where: { id: rule.id },
      });
            
      if (!ruleExists) {
        console.error(`[TwitterService ${toBeiJingTime(new Date())}] 规则 ${rule.id} 不存在，无法启动轮询`);
        return;
      }

      // 添加新方法：主动处理队列
      const processQueue = async () => {
        const queueItem = this.pollingQueue.get(rule.id);
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] 主动处理队列: ${rule.id}, 队列状态:`, queueItem ? 
          `存在(处理中:${queueItem.processing}, 推文数:${queueItem.tweets.length})` : '不存在');
          
        if (queueItem && queueItem.tweets.length > 0 && queueItem.onComplete) {
          try {
            // 标记为处理中，避免重复处理
            queueItem.processing = true;
            console.log(`[TwitterService ${toBeiJingTime(new Date())}] 发现队列中有 ${queueItem.tweets.length} 条匹配推文，执行回调`);
            const tweetsToProcess = [...queueItem.tweets];
            // 清空队列，避免重复处理
            queueItem.tweets = [];
            // 调用回调
            await queueItem.onComplete(tweetsToProcess);
            console.log(`[TwitterService ${toBeiJingTime(new Date())}] 队列回调执行成功`);
          } catch (error) {
            console.error(`[TwitterService ${toBeiJingTime(new Date())}] 处理队列回调失败:`, error);
          } finally {
            // 无论成功或失败，都标记为已完成处理
            if (queueItem) {
              queueItem.processing = false;
            }
          }
        }
      };

      // 修改第一次检查的处理逻辑
      console.log(`[TwitterService ${toBeiJingTime(new Date())}] 开始首次检查: ${rule.id}`);
      
      // 更新轮询时间记录
      this.updateLastPollingTime(rule.id);
      
      // 检查是否当前API限流中
      const firstCheckRateLimitStatus = this.getRateLimitStatus();
      if (firstCheckRateLimitStatus.isLimited) {
        const resetTime = new Date(firstCheckRateLimitStatus.resetTime! * 1000);
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] Twitter API当前限流中，将在 ${resetTime.toLocaleString()} (${firstCheckRateLimitStatus.waitSeconds}秒后) 解除，跳过首次检查`);
      } else {
        // 执行检查并捕获所有推文
        try {
          await this.checkTweets(rule, async (tweet) => {
            const result = await callback(tweet);
            
            // 如果结果表示匹配，直接添加到队列
            if (result && result.matched === true) {
              const queueItem = this.pollingQueue.get(rule.id);
              if (queueItem) {
                console.log(`[TwitterService ${toBeiJingTime(new Date())}] 直接添加匹配推文 ${tweet.id} 到队列`);
                queueItem.tweets.push({
                  id: tweet.id,
                  text: tweet.text,
                  authorId: tweet.authorId,
                  score: result.score || 0,
                  explanation: result.explanation || ''
                });
              } else {
                console.log(`[TwitterService ${toBeiJingTime(new Date())}] 警告：队列项不存在，无法添加推文 ${tweet.id}`);
              }
            }
            
            return result;
          });
        } catch (error: any) {
          console.error(`[TwitterService ${toBeiJingTime(new Date())}] 首次检查推文时出错:`, error.message || '未知错误');
          // 分析是否是限流错误
          if (error.code === 429 || (error.data && error.data.status === 429)) {
            console.log(`[TwitterService ${toBeiJingTime(new Date())}] 首次检查时遇到限流错误，分析限流信息`);
            analyzeRateLimitInfo(error);
          }
          // 即使出错也不中断后续轮询设置
        }
        
        // 首次检查完成后，处理队列
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] 首次检查完成，处理队列...`);
        await processQueue();
        
        // 首次检查完成后，确保更新一次轮询时间，使轮询间隔计算正确
        this.updateLastPollingTime(rule.id);
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] 首次检查和队列处理完成，重置轮询间隔计时`);
      }

      // 确保定时器被正确设置
      this.ensurePollingInterval(rule, callback, processQueue, onComplete);
    } catch (error: any) {
      console.error(`[TwitterService ${toBeiJingTime(new Date())}] 启动轮询失败: ${rule.id}`, error);
      throw error;
    }
  }

  // 新增：确保轮询间隔定时器被正确设置
  private ensurePollingInterval(
    rule: TrackingRule, 
    callback: (tweet: Tweet) => Promise<any>,
    processQueue: () => Promise<void>,
    onComplete?: (tweets: any[]) => Promise<void>
  ): void {
    // 检查是否已存在定时器
    const existingTimer = this.pollingJobs.get(rule.id);
    if (existingTimer) {
      console.log(`[TwitterService ${toBeiJingTime(new Date())}] 规则 ${rule.id} 已有活跃轮询定时器，无需重新创建`);
      return;
    }

    // 创建轮询任务函数
    const pollingTask = async () => {
      // 每次轮询前先检查是否应该轮询
      const shouldPoll = this.shouldPollNow(rule.id, rule.pollingInterval);
      if (!shouldPoll) {
        // 如果还不应该轮询，计算下一次检查时间（短间隔，60秒后再检查）
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] 规则 ${rule.id} 轮询间隔未到，10秒后再次检查`);
        const checkTimerId = setTimeout(pollingTask, 60 * 1000);  // 60秒后再检查
        this.pollingJobs.set(rule.id, checkTimerId);
        return;
      }
      
      console.log(`[TwitterService ${toBeiJingTime(new Date())}] 执行定期轮询: ${rule.id}`);
      
      // 更新轮询时间记录
      this.updateLastPollingTime(rule.id);
      
      // 获取最新的规则数据
      const freshRule = await prisma.trackingRule.findUnique({
        where: { id: rule.id },
        include: { timeSlots: true }
      });
      
      if (!freshRule) {
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] 规则 ${rule.id} 已不存在，停止轮询`);
        this.stopPolling(rule.id);
        return;
      }
      
      if (!freshRule.isActive) {
        console.log(`[TwitterService ${toBeiJingTime(new Date())}] 规则 ${rule.id} 已停用，停止轮询`);
        this.stopPolling(rule.id);
        return;
      }

      // 处理类型转换，确保能传给checkTweets方法
      const trackingRule = {
        ...freshRule,
        notificationPhone: freshRule.notificationPhone || undefined
      };
  
      // 修改执行检查部分，强制捕获处理结果
      try {
        await this.checkTweets(trackingRule, async (tweet) => {
          const result = await callback(tweet);
          
          // 直接在这里处理匹配结果
          if (result && result.matched === true) {
            const queueItem = this.pollingQueue.get(rule.id);
            if (queueItem) {
              console.log(`[TwitterService ${toBeiJingTime(new Date())}] 直接添加匹配推文 ${tweet.id} 到队列`);
              queueItem.tweets.push({
                id: tweet.id,
                text: tweet.text,
                authorId: tweet.authorId,
                score: result.score || 0,
                explanation: result.explanation || ''
              });
            }
          }
          
          return result;
        });
      } catch (error: any) {
        // 捕获并分析错误，特别是限流错误
        console.error(`[TwitterService ${toBeiJingTime(new Date())}] 定期轮询执行出错:`, error.message || '未知错误');
        
        // 分析是否是限流错误
        if (error.code === 429 || (error.data && error.data.status === 429)) {
          console.log(`[TwitterService ${toBeiJingTime(new Date())}] 定期轮询时遇到限流错误，分析限流信息`);
          analyzeRateLimitInfo(error);
        }
      }
      
      // 轮询完成后，强制处理队列
      console.log(`[TwitterService ${toBeiJingTime(new Date())}] 轮询完成，处理队列...`);
      await processQueue();
      
      // 在队列处理完成后，重新更新一次轮询时间，确保下一次轮询时间计算正确
      this.updateLastPollingTime(rule.id);
      console.log(`[TwitterService ${toBeiJingTime(new Date())}] 轮询和队列处理完成，重置轮询间隔计时`);
      
      // 安排下一次轮询 - 直接使用完整的轮询间隔
      console.log(`[TwitterService ${toBeiJingTime(new Date())}] 安排下一次轮询，间隔: ${rule.pollingInterval}秒`);
      const nextTimerId = setTimeout(pollingTask, rule.pollingInterval * 1000);
      
      // 更新定时器ID
      this.pollingJobs.set(rule.id, nextTimerId);
      console.log(`[TwitterService ${toBeiJingTime(new Date())}] 已设置下一次轮询定时器: ${rule.id}`);
    };

    // 立即执行一次检查，确保启动轮询
    console.log(`[TwitterService ${toBeiJingTime(new Date())}] 立即开始首次轮询任务检查: ${rule.id}`);
    const initialTimerId = setTimeout(pollingTask, 100); // 100毫秒后开始，几乎相当于立即执行
    
    // 保存轮询作业标识
    this.pollingJobs.set(rule.id, initialTimerId);
    console.log(`[TwitterService ${toBeiJingTime(new Date())}] 已创建轮询作业: ${rule.id}`);
  }

  // 修改停止轮询方法，适应setTimeout的变化
  stopPolling(ruleId: string, keepQueue: boolean = false): void {
    console.log(`[TwitterService] 停止规则 ${ruleId} 的轮询${keepQueue ? '（保留队列）' : ''}`);

    // 使用全局定时器Map和实例定时器Map
    const globalPollingJobs = global.__twitterPollingJobs as Map<string, NodeJS.Timeout>;
    
    // 从实例Map中清理定时器
    const timerId = this.pollingJobs.get(ruleId);
    if (timerId) {
      clearTimeout(timerId); // 使用clearTimeout替代clearInterval
      this.pollingJobs.delete(ruleId);
      console.log(`[TwitterService] 已移除实例轮询作业: ${ruleId}`);
    }
    
    // 从全局Map中清理定时器
    const globalTimerId = globalPollingJobs.get(ruleId);
    if (globalTimerId) {
      clearTimeout(globalTimerId); // 使用clearTimeout替代clearInterval
      globalPollingJobs.delete(ruleId);
      console.log(`[TwitterService] 已移除全局轮询作业: ${ruleId}`);
    }

    // 清理实例延迟任务
    const delayKey = `${ruleId}_delay`;
    const delayId = this.pollingJobs.get(delayKey);
    if (delayId) {
      clearTimeout(delayId);
      this.pollingJobs.delete(delayKey);
      console.log(`[TwitterService] 已移除实例延迟任务: ${delayKey}`);
    }
    
    // 清理全局延迟任务
    const globalDelayId = globalPollingJobs.get(delayKey);
    if (globalDelayId) {
      clearTimeout(globalDelayId);
      globalPollingJobs.delete(delayKey);
      console.log(`[TwitterService] 已移除全局延迟任务: ${delayKey}`);
    }

    // 只有在不需要保留队列时才清理轮询队列
    if (!keepQueue && this.pollingQueue.has(ruleId)) {
      this.pollingQueue.delete(ruleId);
      console.log(`[TwitterService] 已移除轮询队列: ${ruleId}`);
    } else if (keepQueue && this.pollingQueue.has(ruleId)) {
      console.log(`[TwitterService] 保留轮询队列: ${ruleId}`);
    }
    
    // 防止Node.js事件循环中仍有引用导致的内存泄漏
    try {
      // 强制进行垃圾回收，释放定时器资源
      if (global.gc) {
        global.gc();
        console.log(`[TwitterService] 已强制执行垃圾回收`);
      }
    } catch (e) {
      console.log(`[TwitterService] 无法执行垃圾回收: ${e}`);
    }
    
    // 确认定时器已经被清理
    console.log(`[TwitterService] 停止后检查定时器状态 - 实例: ${this.pollingJobs.has(ruleId) ? '仍存在' : '已清理'}, 全局: ${globalPollingJobs.has(ruleId) ? '仍存在' : '已清理'}`);
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

  // 新增：检查是否应该进行轮询
  public shouldPollNow(ruleId: string, pollingInterval: number): boolean {
    // 首先检查API是否处于限流状态
    const rateLimitStatus = this.getRateLimitStatus();
    if (rateLimitStatus.isLimited) {
      console.log(`[TwitterService ${toBeiJingTime(new Date())}] Twitter API限流中，需等待 ${rateLimitStatus.waitSeconds} 秒，跳过轮询`);
      return false;
    }
    
    const lastPollTime = this.lastPollingTimes.get(ruleId);
    
    // 如果没有记录上次轮询时间，应该轮询
    if (!lastPollTime) {
      console.log(`[TwitterService ${toBeiJingTime(new Date())}] 规则 ${ruleId} 没有上次轮询记录，允许轮询`);
      return true;
    }
    
    const currentTime = Date.now();
    const timeSinceLastPoll = currentTime - lastPollTime;
    const intervalMs = pollingInterval * 1000;
    
    // 检查是否已经达到或超过轮询间隔 - 精确比较，避免舍入误差
    // 加入一个微小容差(100ms)，确保舍入误差不会影响判断
    const shouldPoll = timeSinceLastPoll + 100 >= intervalMs;
    
    if (shouldPoll) {
      console.log(`[TwitterService ${toBeiJingTime(new Date())}] 规则 ${ruleId} 轮询间隔已到，距离上次轮询: ${Math.round(timeSinceLastPoll/1000)}秒，当前间隔: ${pollingInterval}秒，准备执行轮询`);
    } else {
      const remainingTime = (intervalMs - timeSinceLastPoll) / 1000;
      console.log(`[TwitterService ${toBeiJingTime(new Date())}] 规则 ${ruleId} 轮询间隔未到，距离上次轮询: ${Math.round(timeSinceLastPoll/1000)}秒，需要间隔: ${pollingInterval}秒，还需等待: ${Math.round(remainingTime)}秒`);
    }
    
    return shouldPoll;
  }
  
  // 新增：更新轮询时间
  public updateLastPollingTime(ruleId: string): void {
    const currentTime = Date.now();
    this.lastPollingTimes.set(ruleId, currentTime);
    const formattedTime = new Date(currentTime).toLocaleTimeString();
    console.log(`[TwitterService ${toBeiJingTime(new Date())}] 已更新规则 ${ruleId} 的轮询时间记录，记录时间: ${formattedTime}`);
  }

  // 新增：更新API限流重置时间
  public updateRateLimitResetTime(endpoint: string, resetTime: number): void {
    this.rateLimitResetTimes.set(endpoint, resetTime);
    console.log(`[TwitterService ${toBeiJingTime(new Date())}] 已更新API endpoint ${endpoint} 的限流重置时间: ${new Date(resetTime * 1000).toLocaleString()}`);
  }
  
  // 新增：获取API限流状态
  public getRateLimitStatus(endpoint: string = 'default'): { 
    isLimited: boolean; 
    resetTime: number | null;
    waitSeconds: number;
  } {
    const resetTime = this.rateLimitResetTimes.get(endpoint);
    
    if (!resetTime) {
      return {
        isLimited: false,
        resetTime: null,
        waitSeconds: 0
      };
    }
    
    const currentTime = Math.floor(Date.now() / 1000);
    const waitSeconds = Math.max(0, resetTime - currentTime);
    
    return {
      isLimited: waitSeconds > 0,
      resetTime,
      waitSeconds
    };
  }
}

// 导出单例实例，确保整个应用只使用这一个实例
export const twitterServiceSingleton = TwitterService.getInstance();
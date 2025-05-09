import { TwitterApi } from 'twitter-api-v2';
import { env } from '@/config/env';
import { ExtendedTwitterApi } from './types';

/**
 * 获取Twitter API模块
 * 此函数解决了依赖循环问题，并提供TwitterApi实例
 */
export function getTwitterModule(): ExtendedTwitterApi {
  const client = new TwitterApi({
    appKey: env.TWITTER_API_KEY,
    appSecret: env.TWITTER_API_SECRET,
    accessToken: env.TWITTER_ACCESS_TOKEN,
    accessSecret: env.TWITTER_ACCESS_SECRET,
  });

  // 直接扩展客户端对象
  const extendedClient = client as any;

  // 添加getUserByUsername方法
  extendedClient.getUserByUsername = async (username: string) => {
    try {
      const user = await client.v2.userByUsername(username);
      return user.data;
    } catch (error) {
      console.error(`获取用户 @${username} 信息失败:`, error);
      throw error;
    }
  };

  // 添加getUserTweets方法
  extendedClient.getUserTweets = async (username: string, count: number = 10, sinceId?: string) => {
    try {
      // 先获取用户ID
      const user = await client.v2.userByUsername(username);
      if (!user || !user.data || !user.data.id) {
        throw new Error(`无法获取用户 @${username} 的ID`);
      }

      // 构建查询参数
      const params: any = {
        max_results: count,
        'tweet.fields': ['created_at', 'author_id', 'text']
      };

      if (sinceId) {
        params.since_id = sinceId;
      }

      // 获取用户推文
      const timeline = await client.v2.userTimeline(user.data.id, params);
      const tweets = timeline.data.data || [];

      // 转换为所需格式
      return tweets.map((tweet: any) => ({
        id: tweet.id,
        text: tweet.text,
        authorId: tweet.author_id,
        createdAt: tweet.created_at ? new Date(tweet.created_at) : new Date()
      }));
    } catch (error) {
      console.error(`获取用户 @${username} 的推文失败:`, error);
      return [];
    }
  };

  return extendedClient;
} 
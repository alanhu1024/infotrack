import { TwitterApi } from 'twitter-api-v2';
import { env } from '@/config/env';
import type { TrackingRule } from '@/types';

export class TwitterService {
  private client: TwitterApi;
  private pollingJobs: Map<string, NodeJS.Timeout>;

  constructor() {
    this.client = new TwitterApi({
      appKey: env.TWITTER_API_KEY,
      appSecret: env.TWITTER_API_SECRET,
      accessToken: env.TWITTER_ACCESS_TOKEN,
      accessSecret: env.TWITTER_ACCESS_SECRET,
    });
    this.pollingJobs = new Map();
  }

  async getUserTweets(username: string, sinceId?: string): Promise<Array<{
    id: string;
    text: string;
    authorId: string;
    createdAt: Date;
  }>> {
    const user = await this.client.v2.userByUsername(username);
    if (!user.data) {
      throw new Error(`User ${username} not found`);
    }

    const tweets = await this.client.v2.userTimeline(user.data.id, {
      since_id: sinceId,
      "tweet.fields": ["created_at"],
    });

    return tweets.data.data.map(tweet => ({
      id: tweet.id,
      text: tweet.text,
      authorId: user.data.id,
      createdAt: new Date(tweet.created_at!),
    }));
  }

  async startPolling(rule: TrackingRule, callback: (tweet: {
    id: string;
    text: string;
    authorId: string;
    createdAt: Date;
  }) => Promise<void>): Promise<void> {
    if (this.pollingJobs.has(rule.id)) {
      return; // 已经在轮询中
    }

    let lastTweetId: string | undefined;

    const pollTweets = async () => {
      try {
        const tweets = await this.getUserTweets(rule.twitterUsername, lastTweetId);
        
        // 按时间正序处理推文
        const sortedTweets = tweets.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        
        for (const tweet of sortedTweets) {
          await callback(tweet);
          lastTweetId = tweet.id;
        }
      } catch (error) {
        console.error(`Error polling tweets for rule ${rule.id}:`, error);
      }
    };

    // 立即执行一次
    await pollTweets();

    // 设置定时轮询
    const intervalId = setInterval(pollTweets, rule.pollingInterval * 1000);
    this.pollingJobs.set(rule.id, intervalId);
  }

  stopPolling(ruleId: string): void {
    const intervalId = this.pollingJobs.get(ruleId);
    if (intervalId) {
      clearInterval(intervalId);
      this.pollingJobs.delete(ruleId);
    }
  }

  isPolling(ruleId: string): boolean {
    return this.pollingJobs.has(ruleId);
  }
}
import { TwitterApi } from 'twitter-api-v2';

// 扩展的 Twitter API 类型
export interface ExtendedTwitterApi extends TwitterApi {
  getUserByUsername: (username: string) => Promise<any>;
  getUserTweets: (username: string, count: number, sinceId?: string) => Promise<any[]>;
} 
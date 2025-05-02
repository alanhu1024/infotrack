export interface User {
  id: string;
  username: string;
  twitterUsername: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TrackingRule {
  id: string;
  userId: string;
  name: string;
  description: string;
  criteria: string;
  twitterUsername: string;
  isActive: boolean;
  pollingEnabled: boolean;
  pollingInterval: number;
  lastPolledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Tweet {
  id: string;
  tweetId: string;
  authorId: string;
  content: string;
  createdAt: Date;
  matchedRuleId: string;
  analysis: TweetAnalysis;
}

export interface TweetAnalysis {
  id: string;
  tweetId: string;
  relevanceScore: number;
  analysisResult: string;
  createdAt: Date;
}

export interface NotificationChannel {
  id: string;
  userId: string;
  type: 'feishu' | 'dingtalk' | 'wechat';
  config: Record<string, any>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Notification {
  id: string;
  userId: string;
  channelId: string;
  tweetId: string;
  status: 'pending' | 'sent' | 'failed';
  createdAt: Date;
  updatedAt: Date;
} 
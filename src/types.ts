export interface TrackingTimeSlot {
  id: string;
  ruleId: string;
  startTime: string;
  endTime: string;
  pollingInterval: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TrackingRule {
  id: string;
  userId: string;
  name: string;
  description: string;
  criteria: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  twitterUsername: string;
  lastPolledAt: Date | null;
  pollingEnabled: boolean;
  pollingInterval: number;
  notificationPhone?: string;
  lastProcessedTweetId?: string | null;
  llmProvider?: string;
  llmApiKey?: string;
  timeSlots: TrackingTimeSlot[];
}

export interface Tweet {
  id: string;
  tweetId: string;
  content: string;
  authorId: string;
  createdAt: Date;
  matchedRuleId: string;
}

export interface TweetAnalysis {
  id: string;
  tweetId: string;
  relevanceScore: number;
  analysisResult: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface NotificationChannel {
  id: string;
  type: string;
  name: string;
  userId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  config: any; // JsonValue
}

export interface Notification {
  id: string;
  userId: string;
  tweetId: string;
  channelId: string;
  status: string; // 修改为string而不是union类型
  createdAt: Date;
  updatedAt: Date;
}

// 添加NotificationPayload接口
export interface NotificationPayload {
  userId: string;
  channelId: string;
  title: string;
  content: string;
  metadata?: any;
  url?: string; // 确保url字段存在
} 
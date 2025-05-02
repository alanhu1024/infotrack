export interface NotificationPayload {
  userId: string;
  channelId: string;
  title: string;
  content: string;
  metadata?: {
    tweetId: string;
    authorId: string;
    ruleId: string;
    ruleName: string;
    relevanceScore: number;
    analysisResult: string;
  };
}

export interface NotificationService {
  send(payload: NotificationPayload): Promise<void>;
} 
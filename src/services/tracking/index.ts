import { TwitterService } from '../twitter';
import { AIService } from '../ai';
import { NotificationService } from '../notification/types';
import { PrismaClient } from '@prisma/client';
import type { Tweet, TrackingRule, NotificationChannel } from '@/types';

export class TrackingService {
  constructor(
    private twitter: TwitterService,
    private ai: AIService,
    private notifications: Map<string, NotificationService>,
    private prisma: PrismaClient
  ) {}

  async startTracking(rule: TrackingRule): Promise<void> {
    if (!rule.isActive) {
      return;
    }

    // 获取用户的通知渠道
    const channels = await this.prisma.notificationChannel.findMany({
      where: {
        userId: rule.userId,
        isActive: true,
      },
    });

    // 处理推文的回调函数
    const handleTweet = async (tweet: {
      id: string;
      text: string;
      authorId: string;
      createdAt: Date;
    }) => {
      try {
        // 分析推文相关性
        const analysis = await this.ai.analyzeTweetRelevance(tweet.text, rule.criteria);
        
        // 如果相关性分数超过阈值，保存推文并发送通知
        if (analysis.relevanceScore >= 0.7) {
          // 保存推文
          const savedTweet = await this.prisma.tweet.create({
            data: {
              tweetId: tweet.id,
              authorId: tweet.authorId,
              content: tweet.text,
              matchedRuleId: rule.id,
              analysis: {
                create: {
                  relevanceScore: analysis.relevanceScore,
                  analysisResult: analysis.explanation,
                },
              },
            },
          });

          // 发送通知
          for (const channel of channels) {
            const notificationService = this.notifications.get(channel.type);
            if (notificationService) {
              try {
                await notificationService.send({
                  userId: rule.userId,
                  channelId: channel.id,
                  title: `发现相关推文：${rule.name}`,
                  content: tweet.text,
                  metadata: {
                    tweetId: tweet.id,
                    authorId: tweet.authorId,
                    ruleId: rule.id,
                    ruleName: rule.name,
                    relevanceScore: analysis.relevanceScore,
                    analysisResult: analysis.explanation,
                  },
                });

                // 记录通知发送成功
                await this.prisma.notification.create({
                  data: {
                    channelId: channel.id,
                    tweetId: savedTweet.id,
                    status: 'SUCCESS',
                  },
                });
              } catch (error) {
                console.error(`Failed to send notification for tweet ${tweet.id}:`, error);
                // 记录通知发送失败
                await this.prisma.notification.create({
                  data: {
                    channelId: channel.id,
                    tweetId: savedTweet.id,
                    status: 'FAILED',
                    error: error instanceof Error ? error.message : '发送通知失败',
                  },
                });
              }
            }
          }
        }
      } catch (error) {
        console.error(`Error processing tweet ${tweet.id}:`, error);
      }
    };

    // 启动轮询
    await this.twitter.startPolling(rule, handleTweet);
  }

  async stopTracking(rule: TrackingRule): Promise<void> {
    this.twitter.stopPolling(rule.id);
  }

  async restartTracking(rule: TrackingRule): Promise<void> {
    this.twitter.stopPolling(rule.id);
    if (rule.isActive) {
      await this.startTracking(rule);
    }
  }
} 
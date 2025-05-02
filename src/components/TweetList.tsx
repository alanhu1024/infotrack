import { formatDate } from '@/lib/utils';
import type { Tweet, TweetAnalysis, Notification, NotificationChannel } from '@/types';

interface TweetListProps {
  tweets: Array<Tweet & {
    analysis: TweetAnalysis | null;
    notifications: Array<Notification & {
      channel: NotificationChannel;
    }>;
  }>;
}

export function TweetList({ tweets }: TweetListProps) {
  if (tweets.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        暂无匹配的推文
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {tweets.map(tweet => (
        <div key={tweet.id} className="border rounded-lg p-4 space-y-4">
          {/* 推文内容 */}
          <div>
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-sm text-gray-500">推文 ID: {tweet.tweetId}</p>
                <p className="text-sm text-gray-500">作者 ID: {tweet.authorId}</p>
              </div>
              <p className="text-sm text-gray-500">{formatDate(tweet.createdAt)}</p>
            </div>
            <p className="mt-2 text-base">{tweet.content}</p>
          </div>

          {/* AI 分析结果 */}
          {tweet.analysis && (
            <div className="bg-gray-50 rounded p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-gray-700">AI 分析结果</h4>
                <span className="text-sm text-gray-500">
                  相关性：{(tweet.analysis.relevanceScore * 100).toFixed(1)}%
                </span>
              </div>
              <p className="text-sm text-gray-600">{tweet.analysis.analysisResult}</p>
            </div>
          )}

          {/* 通知记录 */}
          {tweet.notifications.length > 0 && (
            <div className="border-t pt-3">
              <h4 className="text-sm font-medium text-gray-700 mb-2">通知记录</h4>
              <div className="space-y-2">
                {tweet.notifications.map(notification => (
                  <div
                    key={notification.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-gray-600">
                      {notification.channel.type === 'feishu' ? '飞书' : '未知渠道'}
                    </span>
                    <div className="flex items-center space-x-2">
                      <span className="text-gray-500">
                        {formatDate(notification.createdAt)}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          notification.status === 'sent'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {notification.status === 'sent' ? '发送成功' : '发送失败'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
} 
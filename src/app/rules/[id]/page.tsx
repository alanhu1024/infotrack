import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { formatDate } from '../../../lib/utils';
import { TweetList } from '../../../components/TweetList';
import type { TrackingRule } from '@/types';

export default async function RuleDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return notFound();
  }

  const ruleData = await prisma.trackingRule.findUnique({
    where: {
      id: params.id,
      userId: session.user.id,
    },
    include: {
      tweets: {
        include: {
          analysis: true,
          notifications: {
            include: {
              channel: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      },
      timeSlots: true,
    },
  });

  if (!ruleData) {
    return notFound();
  }

  // 处理类型兼容性问题
  const rule = {
    ...ruleData,
    notificationPhone: ruleData.notificationPhone || undefined
  };

  return (
    <div className="space-y-6">
      {/* 规则信息 */}
      <div className="bg-white shadow rounded-lg p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{rule.name}</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-500">Twitter 用户</p>
            <p className="text-base font-medium">@{rule.twitterUsername}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">创建时间</p>
            <p className="text-base">{formatDate(rule.createdAt)}</p>
          </div>
          <div className="md:col-span-2">
            <p className="text-sm text-gray-500">规则描述</p>
            <p className="text-base">{rule.description || '无描述'}</p>
          </div>
          <div className="md:col-span-2">
            <p className="text-sm text-gray-500">筛选标准</p>
            <p className="text-base whitespace-pre-wrap">{rule.criteria}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">轮询间隔</p>
            <p className="text-base">{rule.pollingInterval / 60} 分钟</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">最后检查时间</p>
            <p className="text-base">
              {rule.lastPolledAt ? formatDate(rule.lastPolledAt) : '尚未开始'}
            </p>
          </div>
        </div>
      </div>

      {/* 匹配的推文列表 */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          匹配的推文 ({rule.tweets.length})
        </h2>
        <TweetList tweets={rule.tweets} />
      </div>
    </div>
  );
} 
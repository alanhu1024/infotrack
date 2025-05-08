import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { RuleList } from '@/components/RuleList';
import type { TrackingRule } from '@/types';

export const dynamic = 'force-dynamic';

export default async function RulesPage() {
  const session = await getServerSession(authOptions);
  
  if (!session?.user) {
    redirect('/auth/login');
  }

  const rulesData = await prisma.trackingRule.findMany({
    where: {
      userId: session.user.id,
    },
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      timeSlots: true
    }
  });

  // 处理类型不匹配问题，将 notificationPhone 从 string | null 转换为 string | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rules = rulesData.map((rule: any) => ({
    ...rule,
    notificationPhone: rule.notificationPhone || undefined
  })) as TrackingRule[];

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold">追踪规则</h1>
          <p className="text-gray-600 mt-2">管理您的信息追踪规则，包括追踪的 Twitter 用户和筛选标准。</p>
        </div>
        <a
          href="/rules/create"
          className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 transition-colors"
        >
          添加规则
        </a>
      </div>
      <RuleList rules={rules} />
    </div>
  );
} 
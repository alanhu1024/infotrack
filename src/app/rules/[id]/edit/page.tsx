import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import EditRuleForm from '@/components/EditRuleForm';

interface EditRulePageProps {
  params: {
    id: string;
  };
}

export default async function EditRulePage({ params }: EditRulePageProps) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user) {
    redirect('/auth/login');
  }

  const rule = await prisma.trackingRule.findUnique({
    where: {
      id: params.id,
    },
    include: {
      timeSlots: true
    }
  });

  if (!rule) {
    redirect('/rules');
  }

  // 验证规则所有权
  if (rule.userId !== session.user.id) {
    redirect('/rules');
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">编辑追踪规则</h1>
          <p className="text-gray-600 mt-2">
            修改追踪规则的设置，包括 Twitter 用户和筛选条件。
          </p>
        </div>
        <EditRuleForm rule={rule} />
      </div>
    </div>
  );
} 
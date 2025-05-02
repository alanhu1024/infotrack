import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import CreateRuleForm from '@/components/CreateRuleForm';

export default async function CreateRulePage() {
  const session = await getServerSession(authOptions);
  
  if (!session?.user) {
    redirect('/auth/login');
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">创建追踪规则</h1>
          <p className="text-gray-600 mt-2">
            设置要追踪的 Twitter 用户和筛选条件，系统会自动分析并通知您重要信息。
          </p>
        </div>
        <CreateRuleForm />
      </div>
    </div>
  );
} 
'use client';

import { useRouter } from 'next/navigation';
import CreateRuleForm from '@/components/CreateRuleForm';

export default function NewRulePage() {
  const router = useRouter();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">添加追踪规则</h1>
        <p className="mt-1 text-sm text-gray-500">
          设置要追踪的 Twitter 用户和内容筛选标准。
        </p>
      </div>
      
      <CreateRuleForm />
    </div>
  );
} 
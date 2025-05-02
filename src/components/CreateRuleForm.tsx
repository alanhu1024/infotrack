'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';

interface FormData {
  name: string;
  description: string;
  twitterUsername: string;
  criteria: string;
  pollingInterval: number;
}

const POLLING_INTERVALS = [
  { value: 60, label: '1分钟' },
  { value: 300, label: '5分钟' },
  { value: 900, label: '15分钟' },
  { value: 1800, label: '30分钟' },
  { value: 3600, label: '60分钟' },
];

export default function CreateRuleForm() {
  const router = useRouter();
  const [formData, setFormData] = useState<FormData>({
    name: '',
    description: '',
    twitterUsername: '',
    criteria: '',
    pollingInterval: 300, // 默认5分钟
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/rules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || '创建规则失败');
      }

      toast.success('规则创建成功');
      router.push('/rules');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建规则失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'select-one' ? Number(value) : value,
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-white p-6 rounded-lg shadow">
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700">
          规则名称
        </label>
        <input
          type="text"
          id="name"
          name="name"
          value={formData.name}
          onChange={handleChange}
          required
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="例如：AI 技术动态"
        />
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-700">
          描述
        </label>
        <textarea
          id="description"
          name="description"
          value={formData.description}
          onChange={handleChange}
          rows={2}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="添加规则的描述信息"
        />
      </div>

      <div>
        <label htmlFor="twitterUsername" className="block text-sm font-medium text-gray-700">
          Twitter 用户名
        </label>
        <div className="mt-1 flex rounded-md shadow-sm">
          <span className="inline-flex items-center rounded-l-md border border-r-0 border-gray-300 bg-gray-50 px-3 text-gray-500">
            @
          </span>
          <input
            type="text"
            id="twitterUsername"
            name="twitterUsername"
            value={formData.twitterUsername}
            onChange={handleChange}
            required
            className="block w-full rounded-none rounded-r-md border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="用户名"
          />
        </div>
      </div>

      <div>
        <label htmlFor="criteria" className="block text-sm font-medium text-gray-700">
          筛选标准
        </label>
        <textarea
          id="criteria"
          name="criteria"
          value={formData.criteria}
          onChange={handleChange}
          required
          rows={3}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="设置推文内容的筛选标准，系统将根据此标准分析推文的相关性"
        />
      </div>

      <div>
        <label htmlFor="pollingInterval" className="block text-sm font-medium text-gray-700">
          轮询间隔
        </label>
        <select
          id="pollingInterval"
          name="pollingInterval"
          value={formData.pollingInterval}
          onChange={handleChange}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {POLLING_INTERVALS.map(interval => (
            <option key={interval.value} value={interval.value}>
              {interval.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-sm text-gray-500">
          选择检查新推文的时间间隔。
        </p>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {isSubmitting ? '创建中...' : '创建规则'}
        </button>
      </div>
    </form>
  );
} 
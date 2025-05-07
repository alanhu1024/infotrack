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
  notificationPhone?: string;
}

const POLLING_INTERVALS = [
  { value: 900, label: '15分钟' },
  { value: 1800, label: '30分钟' },
  { value: 3600, label: '1小时' },
  { value: 7200, label: '2小时' },
  { value: 10800, label: '3小时' },
  { value: 21600, label: '6小时' },
  { value: 43200, label: '12小时' },
] as const;

export default function CreateRuleForm() {
  const router = useRouter();
  const [formData, setFormData] = useState<FormData>({
    name: '',
    description: '',
    twitterUsername: '',
    criteria: '',
    pollingInterval: 900, // 默认15分钟
    notificationPhone: '',
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

      let data = null;
      try {
        data = await response.json();
      } catch (jsonErr) {
        console.error('解析响应JSON失败', jsonErr);
      }

      if (!response.ok) {
        throw new Error((data && data.message) || '创建规则失败');
      }

      toast.success('规则创建成功，轮询将在后台自动开始');
      router.push('/rules');
    } catch (error) {
      console.error('创建规则出错', error);
      toast.error(error instanceof Error ? error.message : '创建规则失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'pollingInterval' ? Number(value) : value,
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
        />
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-700">
          规则描述（可选）
        </label>
        <textarea
          id="description"
          name="description"
          value={formData.description}
          onChange={handleChange}
          rows={2}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
          rows={5}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <p className="mt-2 text-sm text-gray-500">
          详细描述您感兴趣的内容特征，AI 将根据这些标准来判断推文是否相关。
        </p>
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
        <p className="mt-2 text-sm text-gray-500">
          选择检查新推文的时间间隔，建议选择合适的间隔以平衡实时性和系统负载。
        </p>
      </div>

      <div>
        <label htmlFor="notificationPhone" className="block text-sm font-medium text-gray-700">
          接收电话通知的手机号码
        </label>
        <input
          type="text"
          id="notificationPhone"
          name="notificationPhone"
          value={formData.notificationPhone}
          onChange={handleChange}
          pattern="^1\d{10}$"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="请输入11位手机号码"
        />
        <p className="mt-2 text-sm text-gray-500">
          填写后，当发现匹配规则的推文时，系统将通过外呼平台自动呼叫您的手机。
        </p>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {isSubmitting ? '创建中...' : '创建规则（将在后台开始轮询）'}
        </button>
      </div>
    </form>
  );
} 
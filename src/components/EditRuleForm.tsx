'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import type { TrackingRule } from '@/types';

interface EditRuleFormProps {
  rule: TrackingRule;
}

const POLLING_INTERVALS = [
  { value: 60, label: '1分钟' },
  { value: 300, label: '5分钟' },
  { value: 900, label: '15分钟' },
  { value: 1800, label: '30分钟' },
  { value: 3600, label: '60分钟' },
] as const;

export default function EditRuleForm({ rule }: EditRuleFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [formData, setFormData] = useState({
    name: rule.name,
    description: rule.description,
    twitterUsername: rule.twitterUsername,
    criteria: rule.criteria,
    isActive: true,
    pollingEnabled: true,
    pollingInterval: rule.pollingInterval || POLLING_INTERVALS[0].value,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handlePollingChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: Number(value),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/rules/${rule.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || '更新规则失败');
      }

      toast.success('规则更新成功');
      router.push('/rules');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新规则失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/rules/${rule.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '删除规则失败');
      }

      toast.success('规则已删除');
      router.push('/rules');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除规则失败');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleToggleActive = async () => {
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/rules/${rule.id}/toggle`, {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '切换规则状态失败');
      }

      setFormData(prev => ({ ...prev, isActive: !prev.isActive }));
      toast.success(
        `规则已${formData.isActive ? '停用' : '启用'}`
      );
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '切换规则状态失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
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

        <div className="space-y-4">
          <div>
            <label htmlFor="pollingInterval" className="block text-sm font-medium text-gray-700">
              轮询间隔
            </label>
            <select
              id="pollingInterval"
              name="pollingInterval"
              value={formData.pollingInterval}
              onChange={handlePollingChange}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {POLLING_INTERVALS.map(interval => (
                <option key={interval.value} value={interval.value}>
                  {interval.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-sm text-gray-500">
              选择检查新推文的时间间隔，建议选择合适的间隔以平衡实时性和系统负载。
            </p>
          </div>
        </div>

        <div className="flex justify-between items-center">
          <div className="flex space-x-4">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {isSubmitting ? '保存中...' : '保存更改'}
            </button>
          </div>
          <div className="flex space-x-4">
            <button
              type="button"
              onClick={handleToggleActive}
              disabled={isSubmitting}
              className={`px-4 py-2 text-sm font-medium border rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 ${
                formData.isActive
                  ? 'text-red-700 bg-red-50 border-red-200 hover:bg-red-100 focus:ring-red-500'
                  : 'text-green-700 bg-green-50 border-green-200 hover:bg-green-100 focus:ring-green-500'
              }`}
            >
              {formData.isActive ? '停用规则' : '启用规则'}
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              删除规则
            </button>
          </div>
        </div>
      </form>

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full">
            <h3 className="text-lg font-medium text-gray-900 mb-4">确认删除</h3>
            <p className="text-sm text-gray-500 mb-6">
              您确定要删除这个规则吗？此操作无法撤销，所有相关的追踪记录也将被删除。
            </p>
            <div className="flex justify-end space-x-4">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
              >
                {isDeleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
} 
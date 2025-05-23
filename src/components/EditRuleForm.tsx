'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import type { TrackingRule, TrackingTimeSlot } from '@/types.ts';
import { TimeSlotEditor } from './TimeSlotEditor';
import { useSession } from 'next-auth/react';

interface EditRuleFormProps {
  rule: TrackingRule & { 
    timeSlots?: TrackingTimeSlot[];
  };
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

// 管理员邮箱列表 - 应与后端保持一致
const ADMIN_EMAILS = [process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'admin@example.com'];

export default function EditRuleForm({ rule }: EditRuleFormProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const pendingActionRef = useRef<{ type: 'toggle' | 'delete' | 'save', retries: number } | null>(null);
  const [formData, setFormData] = useState({
    name: rule.name,
    description: rule.description,
    twitterUsername: rule.twitterUsername,
    criteria: rule.criteria,
    isActive: rule.isActive,
    pollingEnabled: rule.pollingEnabled,
    pollingInterval: rule.pollingInterval || POLLING_INTERVALS[0].value,
    timeSlots: rule.timeSlots || [],
    notificationPhone: rule.notificationPhone || '',
  });
  const [isForceStoppingPolling, setIsForceStoppingPolling] = useState(false);
  const [isResettingNotification, setIsResettingNotification] = useState(false);
  
  // 检查用户是否为管理员
  const isAdmin = session?.user?.email && ADMIN_EMAILS.includes(session.user.email);

  useEffect(() => {
    if (pendingActionRef.current && sessionChecked) {
      console.log(`[自动重试] 执行挂起的操作: ${pendingActionRef.current.type}`);
      
      const { type } = pendingActionRef.current;
      
      if (pendingActionRef.current.retries > 3) {
        console.log(`[自动重试] 超过最大重试次数，放弃操作`);
        pendingActionRef.current = null;
        return;
      }
      
      pendingActionRef.current.retries += 1;
      
      switch (type) {
        case 'toggle':
          executeToggleActive();
          break;
        case 'delete':
          executeDelete();
          break;
        case 'save':
          executeSave();
          break;
      }
    }
  }, [sessionChecked]);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const response = await fetch('/api/auth/session');
        const data = await response.json();
        const hasSession = !!data?.user;
        console.log(`[会话检查] 状态: ${hasSession ? '已登录' : '未登录'}`);
        setSessionChecked(hasSession);
        
        if (!hasSession) {
          setTimeout(() => setSessionChecked(false), 5000);
        }
      } catch (error) {
        console.error('[会话检查] 错误:', error);
        setSessionChecked(false);
      }
    };
    
    checkSession();
  }, []);
  
  const executeToggleActive = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    
    try {
      console.log(`[规则操作] 发送切换状态请求: ${rule.id}`);
      const response = await fetch(`/api/rules/${rule.id}/toggle`, {
        method: 'POST',
      });

      if (response.status === 401) {
        console.log(`[规则操作] 会话未授权，标记为挂起操作`);
        pendingActionRef.current = { type: 'toggle', retries: pendingActionRef.current?.retries || 0 };
        setSessionChecked(false);
        return;
      }
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '切换规则状态失败');
      }

      pendingActionRef.current = null;
      setFormData(prev => ({ ...prev, isActive: !prev.isActive }));
      console.log(`[规则操作] 状态已切换为: ${!formData.isActive ? '启用' : '停用'}`);
      toast.success(`规则已${formData.isActive ? '停用' : '启用'}`);
      router.refresh();
    } catch (error) {
      console.error(`[规则操作] 错误:`, error);
      toast.error(error instanceof Error ? error.message : '切换规则状态失败');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleToggleActive = () => {
    console.log(`[用户操作] 点击切换规则状态按钮`);
    pendingActionRef.current = { type: 'toggle', retries: 0 };
    
    if (sessionChecked) {
      executeToggleActive();
    } else {
      console.log(`[用户操作] 会话未加载，已标记为待执行操作`);
      toast.loading('正在准备...');
    }
  };
  
  const executeDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/rules/${rule.id}`, {
        method: 'DELETE',
      });

      if (response.status === 401) {
        console.log(`[规则操作] 删除操作未授权，标记为挂起`);
        pendingActionRef.current = { type: 'delete', retries: pendingActionRef.current?.retries || 0 };
        setSessionChecked(false);
        return;
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '删除规则失败');
      }

      pendingActionRef.current = null;
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
  
  const handleDelete = () => {
    console.log(`[用户操作] 点击删除规则按钮`);
    pendingActionRef.current = { type: 'delete', retries: 0 };
    
    if (sessionChecked) {
      executeDelete();
    } else {
      console.log(`[用户操作] 会话未加载，已标记删除操作为待执行`);
      toast.loading('正在准备...');
    }
  };
  
  const executeSave = async () => {
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/rules/${rule.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (response.status === 401) {
        console.log(`[规则操作] 保存操作未授权，标记为挂起`);
        pendingActionRef.current = { type: 'save', retries: pendingActionRef.current?.retries || 0 };
        setSessionChecked(false);
        return;
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || '更新规则失败');
      }

      pendingActionRef.current = null;
      toast.success('规则更新成功');
      router.push('/rules');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新规则失败');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log(`[用户操作] 提交保存规则表单`);
    pendingActionRef.current = { type: 'save', retries: 0 };
    
    if (sessionChecked) {
      executeSave();
    } else {
      console.log(`[用户操作] 会话未加载，已标记保存操作为待执行`);
      toast.loading('正在准备...');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'pollingInterval' ? Number(value) : value,
    }));
  };

  const handlePollingChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: Number(value),
    }));
  };

  const handleTimeSlotChange = (timeSlots: TrackingTimeSlot[]) => {
    setFormData(prev => ({
      ...prev,
      timeSlots,
    }));
  };

  const executeForceStopPolling = async () => {
    if (isForceStoppingPolling) return;
    setIsForceStoppingPolling(true);
    
    try {
      console.log(`[规则操作] 发送强制停止轮询请求: ${rule.id}`);
      const response = await fetch(`/api/rules/${rule.id}/force-stop`, {
        method: 'POST'
      });
      
      if (response.status === 401) {
        console.log(`[规则操作] 强制停止操作未授权，标记为挂起`);
        toast.error('会话已过期，请刷新页面后重试');
        setSessionChecked(false);
        return;
      }
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '强制停止轮询失败');
      }
      
      setFormData(prev => ({ ...prev, isActive: false }));
      console.log(`[规则操作] 已强制停止轮询`);
      toast.success('已强制停止轮询');
      router.refresh();
    } catch (error) {
      console.error(`[规则操作] 强制停止出错:`, error);
      toast.error(error instanceof Error ? error.message : '强制停止轮询失败');
    } finally {
      setIsForceStoppingPolling(false);
    }
  };
  
  const handleForceStopPolling = () => {
    if (!confirm('确定要强制停止轮询吗？这将清理所有相关的定时器和队列。')) {
      return;
    }
    executeForceStopPolling();
  };

  const executeResetNotification = async () => {
    if (isResettingNotification) return;
    setIsResettingNotification(true);
    
    try {
      console.log(`[规则操作] 发送重置通知状态请求: ${rule.id}`);
      const response = await fetch(`/api/rules/${rule.id}/reset-notification`, {
        method: 'POST'
      });
      
      if (response.status === 401) {
        console.log(`[规则操作] 重置通知操作未授权`);
        toast.error('会话已过期，请刷新页面后重试');
        setSessionChecked(false);
        return;
      }
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '重置通知状态失败');
      }
      
      const result = await response.json();
      console.log(`[规则操作] 已重置通知状态`, result);
      toast.success(`已重置通知状态，${result.details.databaseUpdated}条记录已更新`);
    } catch (error) {
      console.error(`[规则操作] 重置通知状态出错:`, error);
      toast.error(error instanceof Error ? error.message : '重置通知状态失败');
    } finally {
      setIsResettingNotification(false);
    }
  };
  
  const handleResetNotification = () => {
    if (!confirm('确定要重置通知状态吗？这将允许系统重新发送已匹配但未成功通知的推文通知。')) {
      return;
    }
    executeResetNotification();
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

        <div className="space-y-6">
          <TimeSlotEditor
            timeSlots={formData.timeSlots}
            onChange={handleTimeSlotChange}
          />
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
              {isSubmitting ? (pendingActionRef.current?.type === 'save' ? '准备中...' : '保存中...') : '保存更改'}
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
              {isSubmitting && pendingActionRef.current?.type === 'toggle' 
                ? (sessionChecked ? '处理中...' : '准备中...') 
                : (formData.isActive ? '停用规则' : '启用规则')}
            </button>
            
            {isAdmin && formData.isActive && (
              <button
                type="button"
                onClick={handleForceStopPolling}
                disabled={isForceStoppingPolling}
                className="px-4 py-2 text-sm font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-md hover:bg-orange-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50"
              >
                {isForceStoppingPolling ? '处理中...' : '强制停止轮询'}
              </button>
            )}
            
            {isAdmin && (
              <button
                type="button"
                onClick={handleResetNotification}
                disabled={isResettingNotification}
                className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {isResettingNotification ? '处理中...' : '重置通知状态'}
              </button>
            )}
            
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isSubmitting || isDeleting}
              className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
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
                {isDeleting 
                 ? (pendingActionRef.current?.type === 'delete' && !sessionChecked ? '准备中...' : '删除中...') 
                 : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
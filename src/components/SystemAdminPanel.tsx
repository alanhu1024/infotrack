"use client";

import { useState } from 'react';
import { toast } from 'react-hot-toast';

export function SystemAdminPanel() {
  const [isClearingPolling, setIsClearingPolling] = useState(false);
  
  // 清理所有轮询
  const handleClearAllPolling = async () => {
    if (isClearingPolling) return;
    
    // 确认操作
    if (!confirm('确定要清理所有轮询？这将停止所有规则的轮询，并将所有规则标记为非活跃状态。')) {
      return;
    }
    
    setIsClearingPolling(true);
    
    try {
      console.log('[系统管理] 发送清理所有轮询请求');
      const response = await fetch('/api/system/clear-all-polling', {
        method: 'POST'
      });
      
      if (response.status === 401) {
        toast.error('未授权操作，请登录后重试');
        setIsClearingPolling(false);
        return;
      }
      
      const result = await response.json();
      
      if (result.success) {
        console.log('[系统管理] 清理轮询成功:', result);
        toast.success(`清理成功！已停止 ${result.details.rulesUpdated} 个规则的轮询`);
      } else {
        console.error('[系统管理] 清理轮询失败:', result);
        toast.error(`清理失败: ${result.message || '未知错误'}`);
      }
    } catch (error) {
      console.error('[系统管理] 清理轮询请求失败:', error);
      toast.error('操作失败，请查看控制台获取详细信息');
    } finally {
      setIsClearingPolling(false);
    }
  };
  
  return (
    <div className="mt-6 p-4 bg-white rounded-lg shadow">
      <h2 className="text-xl font-semibold mb-4">系统管理</h2>
      
      <div className="space-y-4">
        <div className="p-4 bg-gray-50 rounded-md">
          <h3 className="text-lg font-medium mb-2">轮询管理</h3>
          <p className="text-sm text-gray-600 mb-3">
            如果系统中存在不应该运行的轮询，可以使用以下按钮清理所有轮询。
            这将停止所有规则的轮询，并将所有规则标记为非活跃状态。
          </p>
          
          <button
            onClick={handleClearAllPolling}
            disabled={isClearingPolling}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isClearingPolling ? '清理中...' : '清理所有轮询'}
          </button>
        </div>
      </div>
    </div>
  );
} 
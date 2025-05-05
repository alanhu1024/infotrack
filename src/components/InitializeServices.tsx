'use client';

import { useEffect, useState } from 'react';

// 返回一个唯一的浏览器会话ID，用于判断是否需要重新初始化
const getSessionId = () => {
  if (typeof window === 'undefined') return '';
  
  // 从sessionStorage获取，如果没有则创建新的
  let sessionId = sessionStorage.getItem('app_session_id');
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    sessionStorage.setItem('app_session_id', sessionId);
  }
  return sessionId;
};

export default function InitializeServices() {
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retries, setRetries] = useState(0);

  useEffect(() => {
    // 使用多种方式确保不会过于频繁地初始化
    const isInitialized = sessionStorage.getItem('services_initialized') === 'true';
    const lastInitTime = parseInt(sessionStorage.getItem('last_init_time') || '0', 10);
    const now = Date.now();
    const timeSinceLastInit = now - lastInitTime;
    const currentSessionId = getSessionId();
    const lastSessionId = sessionStorage.getItem('last_init_session') || '';
    
    // 会话ID不变且已初始化且时间间隔小于5分钟，则跳过
    const shouldSkip = isInitialized && 
                      timeSinceLastInit < 5 * 60 * 1000 && 
                      currentSessionId === lastSessionId;
    
    if (shouldSkip && retries === 0) {
      console.log('[Client] 服务最近已初始化，跳过重复初始化');
      console.log(`[Client] 上次初始化: ${new Date(lastInitTime).toLocaleTimeString()}, ${Math.round(timeSinceLastInit/1000)}秒前`);
      setInitialized(true);
      return;
    }
    
    const initializeServices = async () => {
      try {
        if (retries > 0) {
          console.log(`[Client] 初始化服务第 ${retries+1} 次尝试...`);
        } else {
          console.log('[Client] 初始化追踪服务...');
        }
        
        const response = await fetch('/api/boot');
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`初始化服务失败 (${response.status}): ${errorText}`);
        }
        
        const data = await response.json();
        console.log('[Client] 服务初始化结果:', data);
        
        if (data.success) {
          // 记录初始化状态
          sessionStorage.setItem('services_initialized', 'true');
          sessionStorage.setItem('last_init_time', now.toString());
          sessionStorage.setItem('last_init_session', currentSessionId);
          setInitialized(true);
          setError(null);
          console.log(`[Client] 服务初始化成功，当前有 ${data.activeRules || 0} 个活跃规则`);
        } else {
          throw new Error(`初始化服务失败: ${data.message || 'Unknown error'}`);
        }
      } catch (error) {
        console.error('[Client] 服务初始化失败:', error);
        setError(String(error));
        
        // 只有在前3次重试
        if (retries < 3) {
          console.log(`[Client] 将在5秒后重试初始化 (${retries+1}/3)...`);
          setTimeout(() => {
            setRetries(prev => prev + 1);
          }, 5000);
        } else {
          console.error('[Client] 多次初始化失败，放弃重试');
        }
      }
    };
    
    initializeServices();
  }, [retries]); // 添加retries依赖，用于触发重试

  // 不需要渲染任何内容，这只是一个功能组件
  return null;
} 
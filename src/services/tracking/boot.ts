import { trackingService } from '.';
import { prisma } from '@/lib/prisma';
import { importAllPhonesIntoWhitelist } from '@/services/notification/import-phone-whitelist';

// 全局初始化标记，防止并发初始化
let isInitializing = false;
let lastInitializeTime = 0;
let autoInitTimeoutId: NodeJS.Timeout | null = null;

/**
 * 初始化所有追踪服务
 * 在系统启动时调用，确保定时器正确初始化
 */
export async function initializeTracking(): Promise<void> {
  // 检查是否在构建阶段
  const isBuildTime = process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL;
  if (isBuildTime) {
    console.log('[Boot] 检测到在构建阶段，跳过初始化');
    return;
  }
  
  // 防止短时间内重复初始化
  const now = Date.now();
  if (isInitializing) {
    console.log('[Boot] 初始化已在进行中，跳过重复初始化');
    return;
  }
  
  // 距离上次初始化不到1分钟，跳过
  if (now - lastInitializeTime < 60 * 1000) {
    console.log(`[Boot] 距离上次初始化时间不足1分钟，跳过。(${Math.round((now - lastInitializeTime) / 1000)}秒前已初始化)`);
    return;
  }
  
  isInitializing = true;
  lastInitializeTime = now;
  
  try {
    console.log('[Boot] 初始化规则追踪服务...');
    
    // 导入所有规则配置中的手机号码到百度智能外呼平台白名单
    try {
      console.log('[Boot] 开始导入手机号码到百度智能外呼平台白名单...');
      const importResult = await importAllPhonesIntoWhitelist();
      console.log(`[Boot] 导入手机号码白名单结果: ${importResult.message}`, importResult.stats);
    } catch (error) {
      console.error('[Boot] 导入手机号码白名单失败:', error);
      // 继续执行其他初始化步骤，不因白名单导入失败而中断整个初始化流程
    }
    
    // 获取当前所有活跃的定时器
    const activeTimers = trackingService['twitter'].getActiveRuleIds();
    console.log(`[Boot] 当前所有活跃定时器 (${activeTimers.length}个):`, activeTimers);
    
    // 清理所有现有定时器，确保不会有重复运行的规则
    cleanupAllTimers();
    
    // ========== 改进的规则恢复逻辑 ==========
    
    // 1. 获取所有数据库中标记为活跃的规则
    const activeRules = await prisma.trackingRule.findMany({
      where: { isActive: true },
      include: { timeSlots: true }
    });
    console.log(`[Boot] 数据库中标记为活跃的规则 (${activeRules.length}个):`, 
      activeRules.map((r: { id: string, name: string }) => `${r.id} (${r.name})`));
    
    // 2. 获取最近有活动但可能未标记为活跃的规则
    const recentActiveRules = await prisma.trackingRule.findMany({
      where: {
        AND: [
          { lastPolledAt: { not: null } },
          { lastPolledAt: { gt: new Date(Date.now() - 72 * 60 * 60 * 1000) } }, // 扩大到72小时内有轮询
          { isActive: false } // 但当前未标记为活跃
        ]
      },
      include: { timeSlots: true }
    });
    
    // 3. 如果有最近活跃但未标记的规则，将它们标记为活跃并加入到恢复列表
    let rulesToRestore = [...activeRules];
    
    if (recentActiveRules.length > 0) {
      console.log(`[Boot] 发现 ${recentActiveRules.length} 个规则最近有轮询但未标记为活跃状态，将它们恢复`);
      
      for (const rule of recentActiveRules) {
        console.log(`[Boot] 恢复规则 ${rule.id} (${rule.name}) 的活跃状态`);
        
        // 更新数据库中的状态为活跃
        await prisma.trackingRule.update({
          where: { id: rule.id },
          data: { isActive: true }
        });
        
        // 添加到恢复列表，避免重复
        if (!rulesToRestore.some(r => r.id === rule.id)) {
          rulesToRestore.push(rule);
        }
      }
    }
    
    // 4. 确保规则按照创建时间排序，优先启动较早创建的规则
    rulesToRestore.sort((a, b) => 
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    
    // 5. 启动所有需要恢复的规则
    console.log(`[Boot] 准备启动 ${rulesToRestore.length} 个活跃规则的追踪...`);
    
    if (rulesToRestore.length === 0) {
      console.log('[Boot] 没有活跃规则需要启动');
    } else {
      // 批量启动追踪
      for (let i = 0; i < rulesToRestore.length; i++) {
        const rule = rulesToRestore[i];
        try {
          console.log(`[Boot] 启动规则追踪 (${i+1}/${rulesToRestore.length}): ${rule.id} (${rule.name})`);
          
          // 处理类型兼容性问题
          const trackingRule = {
            ...rule,
            notificationPhone: rule.notificationPhone || undefined
          };
          
          // 启动追踪
          await trackingService.startTracking(trackingRule);
          
          // 如果有10个以上规则，每启动5个规则暂停一下，避免过快占用系统资源
          if (rulesToRestore.length > 10 && (i + 1) % 5 === 0 && i < rulesToRestore.length - 1) {
            console.log(`[Boot] 已启动${i + 1}个规则，暂停1秒后继续...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          console.error(`[Boot] 启动规则 ${rule.id} (${rule.name}) 追踪失败:`, error);
        }
      }
    }
    
    // 输出最终活跃的定时器状态
    const finalActiveTimers = trackingService['twitter'].getActiveRuleIds();
    console.log(`[Boot] 初始化完成！当前活跃定时器 (${finalActiveTimers.length}个):`, finalActiveTimers);
    
    return;
  } catch (error) {
    console.error('[Boot] 初始化失败:', error);
    throw error;
  } finally {
    isInitializing = false;
  }
}

/**
 * 清理所有现有定时器的辅助函数
 */
function cleanupAllTimers() {
  try {
    // 获取当前所有活跃的定时器
    const activeTimers = trackingService['twitter'].getActiveRuleIds();
    console.log(`[Boot] 清理前活跃定时器 (${activeTimers.length}个):`, activeTimers);
    
    // 优先使用更彻底的清理所有方法
    if (typeof trackingService['twitter'].clearAllPollingJobs === 'function') {
      console.log(`[Boot] 使用清空所有定时器方法...`);
      trackingService['twitter'].clearAllPollingJobs();
    } else {
      // 备用方法：逐个清理
      activeTimers.forEach(timerId => {
        console.log(`[Boot] 清理现有定时器: ${timerId}`);
        trackingService['twitter'].stopPolling(timerId);
      });
    }
    
    // 验证所有定时器已被清理
    const afterCleanupTimers = trackingService['twitter'].getActiveRuleIds();
    if (afterCleanupTimers.length > 0) {
      console.warn(`[Boot] 警告: 清理后仍有 ${afterCleanupTimers.length} 个定时器:`, afterCleanupTimers);
      console.log(`[Boot] 尝试再次强制清理...`);
      
      // 强制清理 pollingJobs Map
      if (trackingService['twitter']['pollingJobs'] instanceof Map) {
        const pollingJobsMap = trackingService['twitter']['pollingJobs'];
        // 先复制所有key，避免在迭代中修改Map
        const allKeys = Array.from(pollingJobsMap.keys());
        
        // 对每个定时器调用适当的清理方法
        for (const key of allKeys) {
          const timer = pollingJobsMap.get(key);
          if (timer) {
            console.log(`[Boot] 强制清理定时器: ${key}`);
            if (key.includes('_delay')) {
              clearTimeout(timer);
            } else {
              clearInterval(timer);
            }
            pollingJobsMap.delete(key);
          }
        }
        
        // 以防万一，直接清空Map
        pollingJobsMap.clear();
      }
    }
    
    // 再次验证
    const finalCheckTimers = trackingService['twitter'].getActiveRuleIds();
    if (finalCheckTimers.length > 0) {
      console.error(`[Boot] 错误: 强制清理后仍有 ${finalCheckTimers.length} 个定时器:`, finalCheckTimers);
    } else {
      console.log(`[Boot] 所有定时器已成功清理`);
    }
  } catch (error) {
    console.error('[Boot] 清理定时器失败:', error);
  }
}

/**
 * 自动初始化函数
 * 在服务启动后自动执行，无需等待客户端触发
 * 通过环境变量可以控制是否启用(默认启用)
 */
export function setupAutoInitialization() {
  // 如果已经设置了自动初始化，先清除
  if (autoInitTimeoutId) {
    clearTimeout(autoInitTimeoutId);
  }
  
  // 检查是否禁用自动初始化
  const disableAutoInit = process.env.DISABLE_AUTO_INIT === 'true';
  if (disableAutoInit) {
    console.log('[Boot] 自动初始化已通过环境变量禁用');
    return;
  }
  
  console.log('[Boot] 已设置自动初始化，将在5秒后执行');
  
  // 减少延迟为5秒，更快地恢复规则
  autoInitTimeoutId = setTimeout(async () => {
    console.log('[Boot] 执行自动初始化...');
    try {
      // 使用标准初始化流程
      await initializeTracking();
      console.log('[Boot] 自动初始化成功完成');
      
      // 再次检查运行中的规则
      const activeRuleIds = trackingService['twitter'].getActiveRuleIds();
      console.log(`[Boot] 自动初始化完成，当前有 ${activeRuleIds.length} 个活跃规则`);
      
      // 设置定期清理过期通知记录的任务
      setupCleanupTasks();
      
      // 添加一个额外的健康检查步骤
      setTimeout(async () => {
        const activeRuleIds = trackingService['twitter'].getActiveRuleIds();
        if (activeRuleIds.length === 0) {
          console.warn('[Boot] 警告: 启动后没有活跃规则，尝试再次恢复...');
          // 再次尝试初始化
          await initializeTracking();
        } else {
          console.log(`[Boot] 健康检查: 系统正常运行中，有 ${activeRuleIds.length} 个活跃规则`);
        }
      }, 60 * 1000); // 1分钟后检查
      
    } catch (error) {
      console.error('[Boot] 自动初始化失败:', error);
      
      // 即使失败，也尝试一次恢复
      try {
        console.log('[Boot] 尝试在初始化失败后使用备用方法恢复规则...');
        const resumedCount = await trackingService.resumeRecentlyActiveRules(72); // 扩大到72小时
        if (resumedCount > 0) {
          console.log(`[Boot] 通过备用方法恢复了 ${resumedCount} 个规则`);
        }
      } catch (recoveryError) {
        console.error('[Boot] 备用恢复方法也失败了:', recoveryError);
      }
    }
  }, 5 * 1000);
}

/**
 * 设置定期清理任务
 */
function setupCleanupTasks() {
  console.log('[Boot] 设置定期清理任务...');
  
  // 每24小时清理一次过期通知记录
  setInterval(() => {
    console.log('[Boot] 执行定期清理过期通知记录...');
    try {
      trackingService.clearOldNotifiedTweets(7); // 清理7天前的通知记录
    } catch (error) {
      console.error('[Boot] 清理过期通知记录失败:', error);
    }
  }, 24 * 60 * 60 * 1000); // 24小时
  
  // 初始执行一次清理
  setTimeout(() => {
    console.log('[Boot] 初始执行一次通知记录清理...');
    try {
      trackingService.clearOldNotifiedTweets(7);
    } catch (error) {
      console.error('[Boot] 初始清理过期通知记录失败:', error);
    }
  }, 60 * 1000); // 启动1分钟后执行
}

// 在模块加载时自动执行初始化设置
setupAutoInitialization(); 
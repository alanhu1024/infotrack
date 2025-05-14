import { trackingService } from '.';
import { prisma } from '@/lib/prisma';
import { importAllPhonesIntoWhitelist } from '@/services/notification/import-phone-whitelist';
import { toBeiJingTime } from '@/services/twitter';

// 全局初始化标记，防止并发初始化
let isInitializing = false;
let lastInitializeTime = 0;
let autoInitTimeoutId: NodeJS.Timeout | null = null;
// 添加全局初始化完成标志，只在服务器重启前有效
let isInitializationComplete = false;

// 添加全局导入白名单锁
let isImportingWhitelist = false;
let lastWhitelistImportTime = 0;

/**
 * 初始化所有追踪服务
 * 在系统启动时调用，确保定时器正确初始化
 */
export async function initializeTracking(): Promise<void> {
  // 判断是否已在初始化中
  if (isInitializing) {
    console.log(`[Boot ${toBeiJingTime(new Date())}] 初始化已在进行中，跳过重复初始化`);
    return;
  }

  // 如果已经初始化完成且距离上次初始化时间不超过30分钟，直接返回
  if (isInitializationComplete && (Date.now() - lastInitializeTime < 30 * 60 * 1000)) {
    console.log(`[Boot ${toBeiJingTime(new Date())}] 初始化已经完成，跳过重复初始化`);
    return;
  }

  // 检测是否在Edge Runtime中运行 - 使用更安全的方法
  const isEdgeRuntime = typeof process !== 'undefined' && 
    process.env.NEXT_RUNTIME === 'edge';
  
  if (isEdgeRuntime) {
    console.log(`[Boot ${toBeiJingTime(new Date())}] 检测到在Edge Runtime中运行，跳过初始化`);
    throw new Error('不能在Edge Runtime中运行初始化逻辑');
  }

  // 检查是否在构建阶段
  const isBuildTime = process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL;
  if (isBuildTime) {
    console.log(`[Boot ${toBeiJingTime(new Date())}] 检测到在构建阶段，跳过初始化`);
    return;
  }
  
  // 防止短时间内重复初始化
  const now = Date.now();
  
  // 距离上次初始化不到10分钟，跳过（时间从5分钟改为10分钟）
  if (now - lastInitializeTime < 10 * 60 * 1000) {
    console.log(`[Boot ${toBeiJingTime(new Date())}] 距离上次初始化时间不足10分钟，跳过。(${Math.round((now - lastInitializeTime) / 1000)}秒前已初始化)`);
    return;
  }
  
  // 设置锁定状态
  isInitializing = true;
  
  try {
    console.log(`[Boot ${toBeiJingTime(new Date())}] 初始化规则追踪服务...`);
    
    // 首先确保已通知状态从数据库加载
    try {
      console.log(`[Boot ${toBeiJingTime(new Date())}] 从数据库加载通知状态...`);
      await trackingService.loadNotifiedTweets();
    } catch (loadError) {
      console.error(`[Boot ${toBeiJingTime(new Date())}] 加载通知状态失败:`, loadError);
      // 继续执行，不中断初始化流程
    }
    
    // 导入所有规则配置中的手机号码到百度智能外呼平台白名单
    try {
      // 检查是否已在导入白名单过程中
      if (isImportingWhitelist) {
        console.log(`[Boot ${toBeiJingTime(new Date())}] 白名单导入正在进行中，跳过重复导入`);
      } 
      // 检查距离上次导入是否不足30分钟
      else if (now - lastWhitelistImportTime < 30 * 60 * 1000) {
        console.log(`[Boot ${toBeiJingTime(new Date())}] 距离上次白名单导入不足30分钟，跳过。(${Math.round((now - lastWhitelistImportTime) / 1000)}秒前已导入)`);
      }
      else {
        isImportingWhitelist = true;
        try {
          console.log(`[Boot ${toBeiJingTime(new Date())}] 开始导入手机号码到百度智能外呼平台白名单...`);
          const importResult = await importAllPhonesIntoWhitelist();
          console.log(`[Boot ${toBeiJingTime(new Date())}] 导入手机号码白名单结果: ${importResult.message}`, importResult.stats);
          lastWhitelistImportTime = Date.now();
        } finally {
          isImportingWhitelist = false;
        }
      }
    } catch (error) {
      console.error(`[Boot ${toBeiJingTime(new Date())}] 导入手机号码白名单失败:`, error);
      // 继续执行其他初始化步骤，不因白名单导入失败而中断整个初始化流程
    }
    
    // 获取当前所有活跃的定时器
    const activeTimers = trackingService['twitter'].getActiveRuleIds();
    console.log(`[Boot ${toBeiJingTime(new Date())}] 当前所有活跃定时器 (${activeTimers.length}个):`, activeTimers);
    
    // 如果定时器已经在运行，不再重复清理和初始化
    if (activeTimers.length > 0 && isInitializationComplete) {
      console.log(`[Boot ${toBeiJingTime(new Date())}] 定时器已经在运行且初始化标记为已完成，跳过重复初始化`);
      return;
    }
    
    // 清理所有现有定时器，确保不会有重复运行的规则
    cleanupAllTimers();
    
    // ========== 改进的规则恢复逻辑 ==========
    
    // 1. 获取所有数据库中标记为活跃的规则
    const activeRules = await prisma.trackingRule.findMany({
      where: { isActive: true },
      include: { timeSlots: true }
    });
    console.log(`[Boot ${toBeiJingTime(new Date())}] 数据库中标记为活跃的规则 (${activeRules.length}个):`, 
      activeRules.map((r: { id: string, name: string }) => `${r.id} (${r.name})`));
    
    // 2. 不再自动恢复未标记为活跃的规则
    console.log(`[Boot ${toBeiJingTime(new Date())}] 只恢复明确标记为活跃的规则，不恢复历史轮询的规则`);
    
    // 只使用明确标记为活跃的规则
    let rulesToRestore = [...activeRules];
    
    // 记录最近有轮询但未被恢复的规则，便于管理员了解
    const recentActiveRules = await prisma.trackingRule.findMany({
      where: {
        AND: [
          { lastPolledAt: { not: null } },
          { lastPolledAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }, // 24小时内有轮询
          { isActive: false } // 但当前未标记为活跃
        ]
      }
    });
    
    if (recentActiveRules.length > 0) {
      console.log(`[Boot ${toBeiJingTime(new Date())}] 发现 ${recentActiveRules.length} 个规则最近有轮询但未恢复，因为它们未标记为活跃状态:`);
      for (const rule of recentActiveRules) {
        console.log(`- ${rule.id} (${rule.name}), 最后轮询时间: ${rule.lastPolledAt}`);
      }
    }
    
    // 4. 确保规则按照创建时间排序，优先启动较早创建的规则
    rulesToRestore.sort((a, b) => 
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    
    // 5. 启动所有需要恢复的规则
    console.log(`[Boot ${toBeiJingTime(new Date())}] 准备启动 ${rulesToRestore.length} 个活跃规则的追踪...`);
    
    if (rulesToRestore.length === 0) {
      console.log(`[Boot ${toBeiJingTime(new Date())}] 没有活跃规则需要启动`);
    } else {
      // 批量启动追踪
      for (let i = 0; i < rulesToRestore.length; i++) {
        const rule = rulesToRestore[i];
        try {
          console.log(`[Boot ${toBeiJingTime(new Date())}] 启动规则追踪 (${i+1}/${rulesToRestore.length}): ${rule.id} (${rule.name})`);
          
          // 检查是否应该进行轮询（可以直接使用TwitterService的方法）
          const shouldPoll = trackingService['twitter'].shouldPollNow(rule.id, rule.pollingInterval);
          if (!shouldPoll) {
            console.log(`[Boot ${toBeiJingTime(new Date())}] 规则 ${rule.id} 未达到轮询周期，但仍然启动定时器`);
            // 即使未到轮询时间，也设置定时器，但不会立即执行轮询
          }
          
          // 处理类型兼容性问题
          const trackingRule = {
            ...rule,
            notificationPhone: rule.notificationPhone || undefined
          };
          
          // 启动追踪
          await trackingService.startTracking(trackingRule);
          
          // 如果有10个以上规则，每启动5个规则暂停一下，避免过快占用系统资源
          if (rulesToRestore.length > 10 && (i + 1) % 5 === 0 && i < rulesToRestore.length - 1) {
            console.log(`[Boot ${toBeiJingTime(new Date())}] 已启动${i + 1}个规则，暂停1秒后继续...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          console.error(`[Boot ${toBeiJingTime(new Date())}] 启动规则 ${rule.id} (${rule.name}) 追踪失败:`, error);
        }
      }
    }
    
    // 输出最终活跃的定时器状态
    const finalActiveTimers = trackingService['twitter'].getActiveRuleIds();
    console.log(`[Boot ${toBeiJingTime(new Date())}] 初始化完成！当前活跃定时器 (${finalActiveTimers.length}个):`, finalActiveTimers);
    
    // 标记初始化完成
    isInitializationComplete = true;
    lastInitializeTime = Date.now();
    
    return;
  } catch (error) {
    console.error(`[Boot ${toBeiJingTime(new Date())}] 初始化失败:`, error);
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
    console.log(`[Boot ${toBeiJingTime(new Date())}] 清理前活跃定时器 (${activeTimers.length}个):`, activeTimers);
    
    // 优先使用更彻底的清理所有方法
    if (typeof trackingService['twitter'].clearAllPollingJobs === 'function') {
      console.log(`[Boot ${toBeiJingTime(new Date())}] 使用清空所有定时器方法...`);
      trackingService['twitter'].clearAllPollingJobs();
    } else {
      // 备用方法：逐个清理
      activeTimers.forEach(timerId => {
        console.log(`[Boot ${toBeiJingTime(new Date())}] 清理现有定时器: ${timerId}`);
        trackingService['twitter'].stopPolling(timerId);
      });
    }
    
    // 验证所有定时器已被清理
    const afterCleanupTimers = trackingService['twitter'].getActiveRuleIds();
    if (afterCleanupTimers.length > 0) {
      console.warn(`[Boot ${toBeiJingTime(new Date())}] 警告: 清理后仍有 ${afterCleanupTimers.length} 个定时器:`, afterCleanupTimers);
      console.log(`[Boot ${toBeiJingTime(new Date())}] 尝试再次强制清理...`);
      
      // 强制清理 pollingJobs Map
      if (trackingService['twitter']['pollingJobs'] instanceof Map) {
        const pollingJobsMap = trackingService['twitter']['pollingJobs'];
        // 先复制所有key，避免在迭代中修改Map
        const allKeys = Array.from(pollingJobsMap.keys());
        
        // 对每个定时器调用适当的清理方法
        for (const key of allKeys) {
          const timer = pollingJobsMap.get(key);
          if (timer) {
            console.log(`[Boot ${toBeiJingTime(new Date())}] 强制清理定时器: ${key}`);
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
      console.error(`[Boot ${toBeiJingTime(new Date())}] 错误: 强制清理后仍有 ${finalCheckTimers.length} 个定时器:`, finalCheckTimers);
    } else {
      console.log(`[Boot ${toBeiJingTime(new Date())}] 所有定时器已成功清理`);
    }
  } catch (error) {
    console.error(`[Boot ${toBeiJingTime(new Date())}] 清理定时器失败:`, error);
  }
}

/**
 * 自动初始化函数
 * 在服务启动后自动执行，无需等待客户端触发
 * 通过环境变量可以控制是否启用(默认启用)
 */
export function setupAutoInitialization() {
  // 防止重复设置
  if (autoInitTimeoutId) {
    clearTimeout(autoInitTimeoutId);
    autoInitTimeoutId = null; // 清除引用
  }
  
  // 检查是否禁用自动初始化
  const disableAutoInit = process.env.DISABLE_AUTO_INIT === 'true';
  if (disableAutoInit) {
    console.log(`[Boot ${toBeiJingTime(new Date())}] 自动初始化已通过环境变量禁用`);
    return;
  }
  
  // 如果已经完成初始化，不再重复设置
  if (isInitializationComplete) {
    console.log(`[Boot ${toBeiJingTime(new Date())}] 初始化已完成，不再设置自动初始化`);
    return;
  }
  
  // 避免重复初始化
  const now = Date.now();
  if (now - lastInitializeTime < 5 * 60 * 1000) {
    console.log(`[Boot ${toBeiJingTime(new Date())}] 距离上次初始化不足5分钟，跳过设置自动初始化`);
    return;
  }
  
  // 如果正在进行初始化，不再重复设置
  if (isInitializing) {
    console.log(`[Boot ${toBeiJingTime(new Date())}] 初始化正在进行中，跳过设置自动初始化`);
    return;
  }
  
  console.log(`[Boot ${toBeiJingTime(new Date())}] 已设置自动初始化，将在10秒后执行`);
  
  // 增加延迟为10秒，避免过早恢复规则
  autoInitTimeoutId = setTimeout(async () => {
    // 再次检查是否已经完成初始化或者正在初始化中
    if (isInitializationComplete) {
      console.log(`[Boot ${toBeiJingTime(new Date())}] 初始化已被其他进程完成，跳过`);
      return;
    }
    
    if (isInitializing) {
      console.log(`[Boot ${toBeiJingTime(new Date())}] 初始化正在其他地方进行中，跳过自动初始化`);
      return;
    }
    
    // 距离上次初始化时间检查
    const currentTime = Date.now();
    if (currentTime - lastInitializeTime < 5 * 60 * 1000) {
      console.log(`[Boot ${toBeiJingTime(new Date())}] 自动初始化前再次检查：距离上次初始化不足5分钟，跳过`);
      return;
    }
    
    console.log(`[Boot ${toBeiJingTime(new Date())}] 执行自动初始化...`);
    try {
      // 使用标准初始化流程
      await initializeTracking();
      console.log(`[Boot ${toBeiJingTime(new Date())}] 自动初始化成功完成`);
      
      // 再次检查运行中的规则
      const activeRuleIds = trackingService['twitter'].getActiveRuleIds();
      console.log(`[Boot ${toBeiJingTime(new Date())}] 自动初始化完成，当前有 ${activeRuleIds.length} 个活跃规则`);
      
      // 设置定期清理过期通知记录的任务
      setupCleanupTasks();
    } catch (error) {
      console.error(`[Boot ${toBeiJingTime(new Date())}] 自动初始化失败:`, error);
      
      // 不再尝试备用方法恢复规则
      console.log(`[Boot ${toBeiJingTime(new Date())}] 初始化失败后不再尝试自动恢复规则，请手动启用所需规则`);
    }
  }, 10 * 1000);
}

/**
 * 设置定期清理任务
 */
function setupCleanupTasks() {
  console.log(`[Boot ${toBeiJingTime(new Date())}] 设置定期清理任务...`);
  
  // 每24小时清理一次过期通知记录
  setInterval(() => {
    console.log(`[Boot ${toBeiJingTime(new Date())}] 执行定期清理过期通知记录...`);
    try {
      trackingService.clearOldNotifiedTweets(7); // 清理7天前的通知记录
    } catch (error) {
      console.error(`[Boot ${toBeiJingTime(new Date())}] 清理过期通知记录失败:`, error);
    }
  }, 24 * 60 * 60 * 1000); // 24小时
  
  // 每6小时执行一次健康检查，确保规则轮询正常
  setInterval(async () => {
    console.log(`[Boot ${toBeiJingTime(new Date())}] 执行定期健康检查...`);
    try {
      // 获取应该活跃的规则
      const activeRules = await prisma.trackingRule.findMany({
        where: { isActive: true },
        include: { timeSlots: true }
      });
      
      // 获取当前实际活跃的轮询
      const activePollingIds = trackingService['twitter'].getActiveRuleIds();
      
      console.log(`[Boot ${toBeiJingTime(new Date())}] 健康检查: 数据库活跃规则 ${activeRules.length}个, 实际轮询 ${activePollingIds.length}个`);
      
      // 查找需要恢复的规则
      const rulesToRecover = activeRules.filter(rule => !activePollingIds.includes(rule.id));
      
      if (rulesToRecover.length > 0) {
        console.log(`[Boot ${toBeiJingTime(new Date())}] 健康检查: 发现 ${rulesToRecover.length} 个需要恢复的规则`);
        
        // 恢复规则轮询
        for (const rule of rulesToRecover) {
          console.log(`[Boot ${toBeiJingTime(new Date())}] 健康检查: 恢复规则 ${rule.id} (${rule.name}) 的轮询`);
          try {
            // 检查是否应该进行轮询
            const shouldPoll = trackingService['twitter'].shouldPollNow(rule.id, rule.pollingInterval);
            if (!shouldPoll) {
              console.log(`[Boot ${toBeiJingTime(new Date())}] 健康检查: 规则 ${rule.id} 未达到轮询周期，但仍需恢复定时器`);
              // 继续恢复定时器，但内部会跳过实际轮询
            }
            
            // 处理类型兼容性问题
            const trackingRule = {
              ...rule,
              notificationPhone: rule.notificationPhone || undefined
            };
            
            await trackingService.startTracking(trackingRule);
          } catch (error) {
            console.error(`[Boot ${toBeiJingTime(new Date())}] 健康检查: 恢复规则 ${rule.id} 失败:`, error);
          }
        }
      }
      
      // 查找不应该存在的轮询（孤立轮询）
      const activeRuleIds = activeRules.map(rule => rule.id);
      const orphanedPollings = activePollingIds.filter(id => !activeRuleIds.includes(id));
      
      if (orphanedPollings.length > 0) {
        console.log(`[Boot ${toBeiJingTime(new Date())}] 健康检查: 发现 ${orphanedPollings.length} 个孤立轮询`);
        
        // 清理孤立轮询
        for (const id of orphanedPollings) {
          console.log(`[Boot ${toBeiJingTime(new Date())}] 健康检查: 清理孤立轮询 ${id}`);
          trackingService['twitter'].stopPolling(id);
        }
      }
      
      console.log(`[Boot ${toBeiJingTime(new Date())}] 健康检查完成`);
    } catch (error) {
      console.error(`[Boot ${toBeiJingTime(new Date())}] 执行健康检查失败:`, error);
    }
  }, 6 * 60 * 60 * 1000); // 6小时
  
  // 初始执行一次清理
  setTimeout(() => {
    console.log(`[Boot ${toBeiJingTime(new Date())}] 初始执行一次通知记录清理...`);
    try {
      trackingService.clearOldNotifiedTweets(7);
    } catch (error) {
      console.error(`[Boot ${toBeiJingTime(new Date())}] 初始清理过期通知记录失败:`, error);
    }
  }, 60 * 1000); // 启动1分钟后执行
  
  // 系统启动30分钟后执行第一次健康检查
  setTimeout(async () => {
    console.log(`[Boot ${toBeiJingTime(new Date())}] 初始执行一次系统健康检查...`);
    try {
      // 获取应该活跃的规则
      const activeRules = await prisma.trackingRule.findMany({
        where: { isActive: true },
        include: { timeSlots: true }
      });
      
      // 获取当前实际活跃的轮询
      const activePollingIds = trackingService['twitter'].getActiveRuleIds();
      
      console.log(`[Boot ${toBeiJingTime(new Date())}] 初始健康检查: 数据库活跃规则 ${activeRules.length}个, 实际轮询 ${activePollingIds.length}个`);
      
      // 检查不一致，必要时恢复或清理
      if (activeRules.length !== activePollingIds.length) {
        console.log(`[Boot ${toBeiJingTime(new Date())}] 初始健康检查: 检测到不一致状态，将自动修复`);
        
        // 清理所有现有轮询
        cleanupAllTimers();
        
        // 重新启动所有规则
        for (const rule of activeRules) {
          try {
            // 检查是否应该进行轮询
            const shouldPoll = trackingService['twitter'].shouldPollNow(rule.id, rule.pollingInterval);
            if (!shouldPoll) {
              console.log(`[Boot ${toBeiJingTime(new Date())}] 初始健康检查: 规则 ${rule.id} 未达到轮询周期，但仍设置定时器`);
              // 继续设置定时器，但内部不会立即轮询
            }
            
            // 处理类型兼容性问题
            const trackingRule = {
              ...rule,
              notificationPhone: rule.notificationPhone || undefined
            };
            
            await trackingService.startTracking(trackingRule);
          } catch (error) {
            console.error(`[Boot ${toBeiJingTime(new Date())}] 初始健康检查: 启动规则 ${rule.id} 失败:`, error);
          }
        }
        
        console.log(`[Boot ${toBeiJingTime(new Date())}] 初始健康检查: 自动修复完成`);
      } else {
        console.log(`[Boot ${toBeiJingTime(new Date())}] 初始健康检查: 状态一致，无需修复`);
      }
    } catch (error) {
      console.error(`[Boot ${toBeiJingTime(new Date())}] 初始健康检查失败:`, error);
    }
  }, 30 * 60 * 1000); // 30分钟后执行
}

// 在模块加载时自动执行初始化设置
setupAutoInitialization(); 
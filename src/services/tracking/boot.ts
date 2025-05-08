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
    
    // 获取所有活跃规则
    const rules = await prisma.trackingRule.findMany({
      where: { isActive: true },
      include: { timeSlots: true }
    });
    console.log(`[Boot] 数据库中的活跃规则 (${rules.length}个):`, rules.map((r: { id: string, name: string }) => `${r.id} (${r.name})`));
    
    // 额外检查：确保所有规则状态都是最新的
    try {
      console.log('[Boot] 检查所有规则的实际状态...');
      // 获取所有最近有轮询记录的规则，即使它们当前未标记为活跃
      const recentlyActiveRules = await prisma.trackingRule.findMany({
        where: {
          AND: [
            { lastPolledAt: { not: null } },
            { lastPolledAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }, // 最近24小时内有轮询
            { isActive: false } // 但当前未标记为活跃
          ]
        },
        include: { timeSlots: true }
      });
      
      if (recentlyActiveRules.length > 0) {
        console.log(`[Boot] 发现 ${recentlyActiveRules.length} 个规则最近有轮询但未标记为活跃状态，尝试恢复...`);
        
        // 更新这些规则，将它们标记为活跃
        for (const rule of recentlyActiveRules) {
          console.log(`[Boot] 恢复规则 ${rule.id} (${rule.name}) 的活跃状态`);
          await prisma.trackingRule.update({
            where: { id: rule.id },
            data: { isActive: true }
          });
          
          // 将这些恢复的规则添加到要启动的规则列表中
          rules.push(rule);
        }
        
        console.log(`[Boot] 现在有 ${rules.length} 个规则需要启动`);
      }
    } catch (error) {
      console.error('[Boot] 检查规则实际状态失败:', error);
      // 继续执行，不影响正常流程
    }
    
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
    
    // 只处理数据库中标记为活跃的规则
    const ruleCount = rules.length;
    if (ruleCount === 0) {
      console.log('[Boot] 数据库中没有活跃的规则，无需启动追踪');
    } else {
      console.log(`[Boot] 准备启动 ${ruleCount} 个规则的追踪...`);
      
      // 启动追踪
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        try {
          console.log(`[Boot] 启动规则追踪 (${i+1}/${ruleCount}): ${rule.id} (${rule.name})`);
          // 处理类型兼容性问题
          const trackingRule = {
            ...rule,
            notificationPhone: rule.notificationPhone || undefined
          };
          await trackingService.startTracking(trackingRule);
        } catch (error) {
          console.error(`[Boot] 初始化规则追踪失败: ${rule.id} (${rule.name})`, error);
        }
      }
      console.log('[Boot] 规则追踪服务初始化完成.');
    }
    
    // 输出最终活跃的定时器状态
    const finalActiveTimers = trackingService['twitter'].getActiveRuleIds();
    console.log(`[Boot] 初始化后活跃定时器 (${finalActiveTimers.length}个):`, finalActiveTimers);
    
    return;
  } catch (error) {
    console.error('[Boot] 初始化失败:', error);
    throw error;
  } finally {
    isInitializing = false;
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
  
  console.log('[Boot] 已设置自动初始化，将在10秒后执行');
  
  // 减少延迟为10秒，更快地恢复规则
  autoInitTimeoutId = setTimeout(async () => {
    console.log('[Boot] 执行自动初始化...');
    try {
      // 先使用标准初始化流程
      await initializeTracking();
      console.log('[Boot] 自动初始化成功完成');
      
      // 额外调用恢复最近活跃规则的方法，确保所有规则都能被恢复
      // 这可以捕获任何在initializeTracking中可能漏掉的规则
      console.log('[Boot] 尝试恢复最近活跃的规则...');
      const resumedCount = await trackingService.resumeRecentlyActiveRules(48); // 恢复48小时内的规则
      if (resumedCount > 0) {
        console.log(`[Boot] 额外恢复了 ${resumedCount} 个最近活跃的规则`);
      } else {
        console.log('[Boot] 没有额外需要恢复的规则');
      }
      
      // 再次检查自动初始化状态
      console.log('[Boot] 初始化完成，检查运行中的规则...');
      const activeRuleIds = trackingService['twitter'].getActiveRuleIds();
      console.log(`[Boot] 当前有 ${activeRuleIds.length} 个活跃规则: ${activeRuleIds.join(', ')}`);
    } catch (error) {
      console.error('[Boot] 自动初始化失败:', error);
      
      // 即使失败，也尝试一次恢复
      try {
        console.log('[Boot] 尝试在初始化失败后直接恢复规则...');
        const resumedCount = await trackingService.resumeRecentlyActiveRules(72); // 扩大到72小时
        if (resumedCount > 0) {
          console.log(`[Boot] 在初始化失败后直接恢复了 ${resumedCount} 个规则`);
        }
      } catch (recoveryError) {
        console.error('[Boot] 恢复规则也失败了:', recoveryError);
      }
    }
  }, 10 * 1000);
}

// 在模块加载时自动执行初始化设置
setupAutoInitialization(); 
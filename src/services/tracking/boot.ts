import { trackingService } from '.';
import { prisma } from '@/lib/prisma';
import { importAllPhonesIntoWhitelist } from '@/services/notification/import-phone-whitelist';

// 全局初始化标记，防止并发初始化
let isInitializing = false;
let lastInitializeTime = 0;

/**
 * 初始化所有追踪服务
 * 在系统启动时调用，确保定时器正确初始化
 */
export async function initializeTracking(): Promise<void> {
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
          await trackingService.startTracking(rule);
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
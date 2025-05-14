import { prisma } from '@/lib/prisma';
import { notificationServices } from './index';
import { BaiduCallingService } from './baidu-calling';

/**
 * 导入所有规则配置中的手机号码到百度智能外呼平台白名单
 * 这个函数应该在应用启动时调用，确保所有手机号码都在白名单中
 */
export async function importAllPhonesIntoWhitelist(): Promise<{
  success: boolean;
  message: string;
  stats?: {
    totalRules: number;
    phoneCount: number;
    successCount: number;
    failedCount: number;
  };
}> {
  try {
    console.log('[ImportPhoneWhitelist] 开始导入所有规则配置中的手机号码到百度智能外呼平台白名单');
    
    // 获取百度智能外呼服务实例
    const baiduCallingService = notificationServices.get('baidu-calling') as BaiduCallingService | undefined;
    
    if (!baiduCallingService) {
      console.warn('[ImportPhoneWhitelist] 百度智能外呼服务未配置，无法导入手机号码');
      return {
        success: false,
        message: '百度智能外呼服务未配置，无法导入手机号码'
      };
    }
    
    // 从数据库中查询所有配置了通知手机号码的规则
    const rules = await prisma.trackingRule.findMany({
      where: {
        notificationPhone: {
          not: null
        }
      },
      select: {
        id: true,
        name: true,
        notificationPhone: true
      }
    });
    
    console.log(`[ImportPhoneWhitelist] 找到 ${rules.length} 条配置了通知手机号码的规则`);
    
    if (rules.length === 0) {
      return {
        success: true,
        message: '没有找到配置了通知手机号码的规则',
        stats: {
          totalRules: 0,
          phoneCount: 0,
          successCount: 0,
          failedCount: 0
        }
      };
    }
    
    // 提取所有有效的手机号码
    const validPhones: string[] = [];
    
    for (const rule of rules) {
      const phone = rule.notificationPhone;
      if (phone && /^1\d{10}$/.test(phone)) {
        validPhones.push(phone);
      }
    }
    
    // 去重
    const uniquePhones = Array.from(new Set(validPhones));
    
    console.log(`[ImportPhoneWhitelist] 提取到 ${uniquePhones.length} 个唯一手机号码`);
    
    if (uniquePhones.length === 0) {
      return {
        success: true,
        message: '没有找到有效的手机号码',
        stats: {
          totalRules: rules.length,
          phoneCount: 0,
          successCount: 0,
          failedCount: 0
        }
      };
    }
    
    // 批量导入手机号码到白名单
    const importResult = await (baiduCallingService as BaiduCallingService).ensurePhoneInWhitelist(uniquePhones);
    
    // console.log(`[ImportPhoneWhitelist] 导入结果:`, importResult);
    
    return {
      success: importResult.success,
      message: importResult.message,
      stats: {
        totalRules: rules.length,
        phoneCount: uniquePhones.length,
        successCount: importResult.result?.successNum || 0,
        failedCount: importResult.result?.failedNum || 0
      }
    };
    
  } catch (error: any) {
    console.error('[ImportPhoneWhitelist] 导入手机号码到白名单失败:', error);
    return {
      success: false,
      message: `导入手机号码到白名单失败: ${error.message}`
    };
  }
} 
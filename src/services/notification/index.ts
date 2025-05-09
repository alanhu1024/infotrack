import { FeishuNotificationService } from './feishu';
import { BaiduCallingService } from './baidu-calling';
import type { NotificationService } from './types';
import { env } from '@/config/env';

// 创建通知服务映射
const services: [string, NotificationService][] = [];

// 注释掉飞书服务初始化，避免因凭证缺失而报错
// if (env.FEISHU_APP_ID && env.FEISHU_APP_SECRET) {
//   services.push(['feishu', new FeishuNotificationService()]);
// }

// 记录环境变量配置情况
console.log('[NotificationServices] 检查百度智能外呼平台环境变量配置:');
console.log(`[NotificationServices] BAIDU_ACCESS_KEY: ${env.BAIDU_ACCESS_KEY ? '已配置' : '未配置'}`);
console.log(`[NotificationServices] BAIDU_SECRET_KEY: ${env.BAIDU_SECRET_KEY ? '已配置' : '未配置'}`);
console.log(`[NotificationServices] BAIDU_ROBOT_ID: ${env.BAIDU_ROBOT_ID ? '已配置' : '未配置'}`);
console.log(`[NotificationServices] BAIDU_CALLER_NUMBER: ${env.BAIDU_CALLER_NUMBER ? '已配置' : '未配置'}`);

// 只有配置了百度智能外呼平台凭证时才添加该服务
if (env.BAIDU_ACCESS_KEY && env.BAIDU_SECRET_KEY && env.BAIDU_ROBOT_ID && env.BAIDU_CALLER_NUMBER) {
  console.log('[NotificationServices] 百度智能外呼服务环境变量检查通过，初始化服务');
  services.push(['baidu-calling', new BaiduCallingService()]);
} else {
  console.error('[NotificationServices] 百度智能外呼服务环境变量配置不完整，无法初始化');
}

export const notificationServices = new Map<string, NotificationService>(services);
console.log(`[NotificationServices] 已初始化 ${notificationServices.size} 个通知服务:`, Array.from(notificationServices.keys())); 
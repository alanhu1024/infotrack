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

// 只有配置了百度智能外呼平台凭证时才添加该服务
if (env.BAIDU_ACCESS_KEY && env.BAIDU_SECRET_KEY && env.BAIDU_ROBOT_ID && env.BAIDU_CALLER_NUMBER) {
  services.push(['baidu-calling', new BaiduCallingService()]);
}

export const notificationServices = new Map<string, NotificationService>(services); 
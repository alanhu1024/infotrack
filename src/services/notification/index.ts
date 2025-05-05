import { FeishuNotificationService } from './feishu';
import type { NotificationService } from './types';

export const notificationServices = new Map<string, NotificationService>([
  ['feishu', new FeishuNotificationService()],
]); 
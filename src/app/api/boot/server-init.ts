/**
 * 这个文件作为 boot API 的一部分，会在服务器启动时自动加载
 * 用于确保在服务器启动时自动初始化追踪规则
 */

// 导入 boot 模块
import { setupAutoInitialization } from '@/services/tracking/boot';

// 设置服务启动时间
const SERVER_START_TIME = Date.now();

// 记录日志
console.log(`[ServerInit] 服务器启动时间: ${new Date(SERVER_START_TIME).toISOString()}`);
console.log('[ServerInit] 服务器初始化模块已加载');

// 立即设置自动初始化
setupAutoInitialization();

console.log('[ServerInit] 自动初始化已设置');

// 导出服务器启动时间，以便其他模块使用
export const serverStartTime = SERVER_START_TIME; 
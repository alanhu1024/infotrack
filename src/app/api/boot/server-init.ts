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

// 检查是否在构建阶段
const isBuildTime = process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL;
if (isBuildTime) {
  console.log('[ServerInit] 检测到在构建阶段，跳过自动初始化设置');
} else {
  // 非构建阶段，正常设置自动初始化
  setupAutoInitialization();
  console.log('[ServerInit] 自动初始化已设置');
}

// 导出服务器启动时间，以便其他模块使用
export const serverStartTime = SERVER_START_TIME; 
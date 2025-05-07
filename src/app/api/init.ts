/**
 * 这个文件会在服务器启动时被自动导入
 * 用于确保在服务器启动时初始化必要的服务
 */

// 导入boot模块，触发自动初始化设置
import '@/services/tracking/boot';

console.log('[Server] 服务器初始化文件已加载，自动初始化设置已启动');

// 导出一个标记，表示初始化已完成
export const initialized = true; 
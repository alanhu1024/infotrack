/**
 * 这个文件会在服务器启动时被自动导入
 * 用于确保在服务器启动时初始化必要的服务
 */

// 使用模块全局变量来确保只初始化一次
const globalAny = global as any;
if (!globalAny.__initRun) {
  globalAny.__initRun = true;
  
  // 导入boot模块，触发自动初始化设置
  import('@/services/tracking/boot')
    .then(() => {
      console.log(`[Server ${new Date().toLocaleString()}] 服务器初始化文件已加载，自动初始化设置已启动`);
    })
    .catch(error => {
      console.error(`[Server ${new Date().toLocaleString()}] 服务器初始化文件加载失败:`, error);
    });
} else {
  console.log(`[Server ${new Date().toLocaleString()}] 服务器初始化文件已经加载过，跳过重复初始化`);
}

// 导入格式化时间函数
import { toBeiJingTime } from '@/services/twitter';

// 导出一个标记，表示初始化已完成
export const initialized = true; 
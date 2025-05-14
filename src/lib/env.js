import { config } from 'dotenv';

// 加载环境变量
config();

// 确保关键环境变量存在
const requiredEnvs = [
  'DATABASE_URL',
  // 添加其他必需的环境变量
];

// 检查必需的环境变量
for (const env of requiredEnvs) {
  if (!process.env[env]) {
    console.warn(`警告: 环境变量 ${env} 未设置`);
  }
}

export {}; 
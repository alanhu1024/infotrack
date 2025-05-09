export function formatDate(date: Date): string {
  // 转换为北京时间 (UTC+8)
  const beijingTime = new Date(new Date(date).getTime() + 8 * 60 * 60 * 1000);
  
  return beijingTime.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai'
  });
} 
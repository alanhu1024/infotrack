import { NextResponse } from 'next/server';

// 简单的健康检查端点，无论其他服务如何都会返回200
export async function GET() {
  return NextResponse.json({ 
    status: 'ok', 
    timestamp: Date.now() 
  });
} 
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import { Providers } from './providers';
import { UserNav } from '@/components/user-nav';
import Navigation from '@/components/Navigation';
import InitializeServices from "@/components/InitializeServices";

// 导入服务器初始化模块，确保在服务器启动时自动加载
import '@/app/api/init';

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "InfoTrack - 智能信息追踪系统",
  description: "自动追踪 Twitter 上的重要信息，使用 GPT-4 进行智能分析，通过多渠道实时通知。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className={inter.className}>
        <Providers>
          <InitializeServices />
          <div className="min-h-screen bg-gray-50">
            <Navigation />
            <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
            {children}
            </main>
          </div>
        </Providers>
        <Toaster />
      </body>
    </html>
  );
}

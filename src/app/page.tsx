import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Link from 'next/link';

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
      <h1 className="text-5xl font-bold mb-6">智能信息追踪系统</h1>
      <p className="text-xl text-gray-600 mb-8 max-w-2xl">
        自动追踪 Twitter 上的重要信息，使用 GPT-4 进行智能分析，通过多渠道实时通知，让您不错过任何重要信息。
      </p>
      <div className="flex gap-4 items-center">
        <Link
          href={session ? "/rules" : "/auth/register"}
          className="bg-blue-600 text-white px-6 py-3 rounded-md hover:bg-blue-700 transition-colors"
        >
          开始使用
        </Link>
        <Link
          href="/about"
          className="text-blue-600 hover:text-blue-700 transition-colors"
        >
          了解更多 →
        </Link>
      </div>
    </div>
  );
}

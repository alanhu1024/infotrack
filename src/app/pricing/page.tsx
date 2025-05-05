import { PricingPlans } from '@/components/pricing/PricingPlans';

export const metadata = {
  title: 'InfoTrack - 定价套餐',
  description: '选择适合您的 InfoTrack 订阅套餐，信息追踪、智能分析与实时通知的全方位解决方案',
};

export default function PricingPage() {
  return (
    <div className="py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h1 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">
            简单透明的定价方案
          </h1>
          <p className="mt-4 text-xl text-gray-600">
            根据您的需求选择合适的方案，随时可以升级或降级
          </p>
        </div>
        
        <PricingPlans />
      </div>
    </div>
  );
} 
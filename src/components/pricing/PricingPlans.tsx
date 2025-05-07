'use client';

import { useState, useEffect } from 'react';
import { CheckIcon } from '@heroicons/react/24/outline';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';

type PlanFeature = {
  title: string;
  tiers: {
    free: boolean | string;
    basic: boolean | string;
    pro: boolean | string;
    premium: boolean | string;
  };
};

type SubscriptionPlan = 'FREE' | 'BASIC' | 'PRO' | 'PREMIUM';

type SubscriptionData = {
  subscription: {
    id: string;
    plan: SubscriptionPlan;
    paymentType: string;
  };
  usage: {
    rulesUsed: number;
    notificationsUsed: number;
    remainingRules: number;
    remainingNotifications: number;
  };
};

const features: PlanFeature[] = [
  {
    title: '可追踪规则数',
    tiers: {
      free: '1个',
      basic: '5个',
      pro: '20个',
      premium: '无限',
    },
  },
  {
    title: '每月付费通知数',
    tiers: {
      free: '10条',
      basic: '200条',
      pro: '1000条',
      premium: '5000条',
    },
  },
  {
    title: '自动重试',
    tiers: {
      free: false,
      basic: true,
      pro: true,
      premium: true,
    },
  },
  {
    title: '优先支持',
    tiers: {
      free: false,
      basic: false,
      pro: true,
      premium: true,
    },
  },
  {
    title: '历史数据存储',
    tiers: {
      free: '7天',
      basic: '30天',
      pro: '90天',
      premium: '1年',
    },
  },
  {
    title: 'API访问',
    tiers: {
      free: false,
      basic: false,
      pro: true,
      premium: true,
    },
  },
  {
    title: '专属客户经理',
    tiers: {
      free: false,
      basic: false,
      pro: false,
      premium: true,
    },
  },
];

export function PricingPlans() {
  const [annual, setAnnual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [userSubscription, setUserSubscription] = useState<SubscriptionData | null>(null);
  const { data: session, status } = useSession();
  
  const prices = {
    free: { monthly: '¥0', annually: '¥0' },
    basic: { monthly: '¥39', annually: '¥399' },
    pro: { monthly: '¥99', annually: '¥999' },
    premium: { monthly: '¥299', annually: '¥2999' },
  };

  // 获取用户当前订阅信息
  useEffect(() => {
    if (status === 'authenticated') {
      fetchUserSubscription();
    }
  }, [status]);

  const fetchUserSubscription = async () => {
    try {
      const response = await fetch('/api/subscription');
      if (response.ok) {
        const data = await response.json();
        setUserSubscription(data);
        
        // 设置付费类型（月付/年付）
        if (data.subscription.paymentType === 'annually') {
          setAnnual(true);
        }
      }
    } catch (error) {
      console.error('获取订阅信息失败:', error);
    }
  };

  // 处理计划升级
  const handleSubscribe = async (plan: SubscriptionPlan) => {
    if (status !== 'authenticated') {
      toast.error('请先登录再订阅');
      return;
    }

    if (userSubscription?.subscription.plan === plan) {
      toast('您已经订阅了此计划');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          plan,
          paymentType: annual ? 'annually' : 'monthly',
          // 在实际应用中，这里会有支付处理的逻辑
        }),
      });

      if (response.ok) {
        toast.success('订阅计划更新成功！');
        fetchUserSubscription();
      } else {
        const data = await response.json();
        toast.error(data.error || '订阅更新失败');
      }
    } catch (error) {
      console.error('更新订阅失败:', error);
      toast.error('订阅更新失败，请稍后再试');
    } finally {
      setLoading(false);
    }
  };

  const isCurrentPlan = (plan: SubscriptionPlan) => {
    return userSubscription?.subscription.plan === plan;
  };

  return (
    <div className="mt-12 space-y-12 lg:space-y-6 lg:grid lg:grid-cols-4 lg:gap-x-6">
            <div className="mt-2 flex justify-center col-span-4">
        <div className="relative bg-gray-100 rounded-lg p-0.5">
          <button
            type="button"
            className={`relative w-16 py-1 text-sm font-medium rounded-md ${
              !annual ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'
            }`}
            onClick={() => setAnnual(false)}
          >
            月付
          </button>
          <button
            type="button"
            className={`relative w-16 py-1 text-sm font-medium rounded-md ${
              annual ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'
            }`}
            onClick={() => setAnnual(true)}
          >
            年付
            {/* <span className="absolute -top-3 -right-3 px-2 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-800">
              省20%
            </span> */}
          </button>
        </div>
      </div>

      <div className="relative p-2 bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col">
        <div className="flex-1">
          <h3 className="text-xl font-semibold text-gray-900">免费版</h3>
          <p className="mt-4 flex items-baseline text-gray-900">
            <span className="text-4xl font-extrabold tracking-tight">
              {annual ? prices.free.annually : prices.free.monthly}
            </span>
            <span className="ml-1 text-xl font-semibold">/{annual ? '年' : '月'}</span>
          </p>
          <p className="mt-2 text-sm text-gray-500">个人爱好者的理想选择</p>

          <ul role="list" className="mt-6 space-y-4">
            {features.map((feature) => (
              <li key={feature.title} className="flex space-x-3">
                {feature.tiers.free ? (
                  <>
                    <CheckIcon className="flex-shrink-0 h-5 w-5 text-green-500" aria-hidden="true" />
                    <span className="text-sm text-gray-500">
                      {typeof feature.tiers.free === 'string' ? feature.title+": "+feature.tiers.free : feature.title}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-gray-300 ml-8">{feature.title}</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <button
          type="button"
          disabled={loading || isCurrentPlan('FREE') || status !== 'authenticated'}
          className={`mt-8 block w-full ${
            isCurrentPlan('FREE')
              ? 'bg-gray-50 text-gray-700 border border-gray-300'
              : 'bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200'
          } py-2 px-3 text-sm font-medium text-center rounded-md`}
          onClick={() => handleSubscribe('FREE')}
        >
          {isCurrentPlan('FREE') ? '当前方案' : '选择免费版'}
        </button>
      </div>

      <div className="relative p-6 bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col">
        <div className="flex-1">
          <h3 className="text-xl font-semibold text-gray-900">基础版</h3>
          <p className="mt-4 flex items-baseline text-gray-900">
            <span className="text-4xl font-extrabold tracking-tight">
              {annual ? prices.basic.annually : prices.basic.monthly}
            </span>
            <span className="ml-1 text-xl font-semibold">/{annual ? '年' : '月'}</span>
          </p>
          <p className="mt-2 text-sm text-gray-500">小型创作者和个人用户</p>

          <ul role="list" className="mt-6 space-y-4">
            {features.map((feature) => (
              <li key={feature.title} className="flex space-x-3">
                {feature.tiers.basic ? (
                  <>
                    <CheckIcon className="flex-shrink-0 h-5 w-5 text-green-500" aria-hidden="true" />
                    <span className="text-sm text-gray-500">
                      {typeof feature.tiers.basic === 'string' ? feature.title+": "+feature.tiers.basic : feature.title}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-gray-300 ml-8">{feature.title}</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <button
          type="button"
          disabled={loading || isCurrentPlan('BASIC') || status !== 'authenticated'}
          className={`mt-8 block w-full ${
            isCurrentPlan('BASIC')
              ? 'bg-indigo-100 text-indigo-700 border border-indigo-300'
              : 'bg-indigo-600 text-white hover:bg-indigo-700'
          } py-2 px-3 text-sm font-medium text-center rounded-md`}
          onClick={() => handleSubscribe('BASIC')}
        >
          {loading ? '处理中...' : isCurrentPlan('BASIC') ? '当前方案' : '升级到基础版'}
        </button>
      </div>

      <div className="relative p-6 bg-white border border-indigo-200 rounded-2xl shadow-sm flex flex-col">
        <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/4 bg-indigo-600 text-white px-3 py-1 text-sm font-semibold rounded-full">
          最受欢迎
        </div>
        <div className="flex-1">
          <h3 className="text-xl font-semibold text-gray-900">专业版</h3>
          <p className="mt-4 flex items-baseline text-gray-900">
            <span className="text-4xl font-extrabold tracking-tight">
              {annual ? prices.pro.annually : prices.pro.monthly}
            </span>
            <span className="ml-1 text-xl font-semibold">/{annual ? '年' : '月'}</span>
          </p>
          <p className="mt-2 text-sm text-gray-500">专业创作者和企业用户</p>

          <ul role="list" className="mt-6 space-y-4">
            {features.map((feature) => (
              <li key={feature.title} className="flex space-x-3">
                {feature.tiers.pro ? (
                  <>
                    <CheckIcon className="flex-shrink-0 h-5 w-5 text-green-500" aria-hidden="true" />
                    <span className="text-sm text-gray-500">
                      {typeof feature.tiers.pro === 'string' ? feature.title+": "+feature.tiers.pro : feature.title}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-gray-300 ml-8">{feature.title}</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <button
          type="button"
          disabled={loading || isCurrentPlan('PRO') || status !== 'authenticated'}
          className={`mt-8 block w-full ${
            isCurrentPlan('PRO')
              ? 'bg-indigo-100 text-indigo-700 border border-indigo-300'
              : 'bg-indigo-600 text-white hover:bg-indigo-700'
          } py-2 px-3 text-sm font-medium text-center rounded-md border border-transparent`}
          onClick={() => handleSubscribe('PRO')}
        >
          {loading ? '处理中...' : isCurrentPlan('PRO') ? '当前方案' : '升级到专业版'}
        </button>
      </div>

      <div className="relative p-6 bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col">
        <div className="flex-1">
          <h3 className="text-xl font-semibold text-gray-900">高级版</h3>
          <p className="mt-4 flex items-baseline text-gray-900">
            <span className="text-4xl font-extrabold tracking-tight">
              {annual ? prices.premium.annually : prices.premium.monthly}
            </span>
            <span className="ml-1 text-xl font-semibold">/{annual ? '年' : '月'}</span>
          </p>
          <p className="mt-2 text-sm text-gray-500">企业和大型团队</p>

          <ul role="list" className="mt-6 space-y-4">
            {features.map((feature) => (
              <li key={feature.title} className="flex space-x-3">
                {feature.tiers.premium ? (
                  <>
                    <CheckIcon className="flex-shrink-0 h-5 w-5 text-green-500" aria-hidden="true" />
                    <span className="text-sm text-gray-500">
                      {typeof feature.tiers.premium === 'string' ? feature.title+": "+feature.tiers.premium : feature.title}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-gray-300 ml-8">{feature.title}</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <button
          type="button"
          disabled={loading || isCurrentPlan('PREMIUM') || status !== 'authenticated'}
          className={`mt-8 block w-full ${
            isCurrentPlan('PREMIUM')
              ? 'bg-indigo-100 text-indigo-700 border border-indigo-300'
              : 'bg-indigo-600 text-white hover:bg-indigo-700'
          } py-2 px-3 text-sm font-medium text-center rounded-md`}
          onClick={() => handleSubscribe('PREMIUM')}
        >
          {loading ? '处理中...' : isCurrentPlan('PREMIUM') ? '当前方案' : '升级到高级版'}
        </button>
      </div>

      <div className="col-span-4 mt-8 text-center">
        <p className="text-sm text-gray-500">
          所有套餐额度在每个自然月开始时重置。套餐可随时变更，按照新套餐额度使用。
          <br />如需定制企业方案，请<a href="#" className="font-medium text-indigo-600 hover:text-indigo-500">联系我们</a>。
        </p>
      </div>

    </div>
  );
} 
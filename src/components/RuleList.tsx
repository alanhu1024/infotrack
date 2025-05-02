import type { TrackingRule } from '@prisma/client';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

interface RuleListProps {
  rules: TrackingRule[];
}

export default function RuleList({ rules }: RuleListProps) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              规则名称
            </th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Twitter 用户
            </th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              状态
            </th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              轮询模式
            </th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              创建时间
            </th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              操作
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {rules.map((rule) => (
            <tr key={rule.id}>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                {rule.name}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {rule.twitterUsername}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                  rule.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                }`}>
                  {rule.isActive ? '运行中' : '已停止'}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {rule.pollingEnabled ? (
                  <span className="text-indigo-600">
                    每 {Math.floor(rule.pollingInterval / 60)} 分钟
                  </span>
                ) : (
                  <span className="text-gray-500">实时监听</span>
                )}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {format(new Date(rule.createdAt), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-indigo-600 hover:text-indigo-900">
                <a href={`/rules/${rule.id}/edit`} className="text-indigo-600 hover:text-indigo-900">
                  编辑
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rules.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          暂无追踪规则，请点击"添加规则"按钮创建新规则。
        </div>
      )}
    </div>
  );
} 
import { useState } from 'react';
import type { TrackingTimeSlot } from '@/types';

const POLLING_INTERVALS = [
  { value: 60, label: '1分钟' },
  { value: 300, label: '5分钟' },
  { value: 900, label: '15分钟' },
  { value: 1800, label: '30分钟' },
  { value: 3600, label: '60分钟' },
] as const;

type PollingInterval = typeof POLLING_INTERVALS[number]['value'];

interface TimeSlotEditorProps {
  timeSlots: TrackingTimeSlot[];
  onChange: (timeSlots: TrackingTimeSlot[]) => void;
}

export function TimeSlotEditor({ timeSlots, onChange }: TimeSlotEditorProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTimeSlot, setNewTimeSlot] = useState({
    startTime: '09:00',
    endTime: '18:00',
    pollingInterval: POLLING_INTERVALS[0].value as PollingInterval,
  });

  const handleAdd = () => {
    const slot = {
      id: `temp_${Date.now()}`,
      ruleId: '',
      startTime: newTimeSlot.startTime,
      endTime: newTimeSlot.endTime,
      pollingInterval: newTimeSlot.pollingInterval,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    onChange([...timeSlots, slot]);
    setShowAddForm(false);
    setNewTimeSlot({
      startTime: '09:00',
      endTime: '18:00',
      pollingInterval: POLLING_INTERVALS[0].value as PollingInterval,
    });
  };

  const handleDelete = (index: number) => {
    const newSlots = [...timeSlots];
    newSlots.splice(index, 1);
    onChange(newSlots);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium text-gray-900">时间段设置</h3>
        {!showAddForm && (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="text-sm text-indigo-600 hover:text-indigo-900"
          >
            添加时间段
          </button>
        )}
      </div>

      {/* 现有时间段列表 */}
      <div className="space-y-3">
        {timeSlots.map((slot, index) => (
          <div
            key={slot.id}
            className="flex items-center space-x-4 bg-gray-50 p-3 rounded-md"
          >
            <div className="flex-1">
              <span className="text-sm font-medium text-gray-900">
                {slot.startTime} - {slot.endTime}
              </span>
              <span className="ml-4 text-sm text-gray-500">
                每 {slot.pollingInterval / 60} 分钟检查一次
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleDelete(index)}
              className="text-sm text-red-600 hover:text-red-900"
            >
              删除
            </button>
          </div>
        ))}
      </div>

      {/* 添加新时间段表单 */}
      {showAddForm && (
        <div className="border rounded-md p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="startTime" className="block text-sm font-medium text-gray-700">
                开始时间
              </label>
              <input
                type="time"
                id="startTime"
                value={newTimeSlot.startTime}
                onChange={(e) =>
                  setNewTimeSlot((prev) => ({ ...prev, startTime: e.target.value }))
                }
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label htmlFor="endTime" className="block text-sm font-medium text-gray-700">
                结束时间
              </label>
              <input
                type="time"
                id="endTime"
                value={newTimeSlot.endTime}
                onChange={(e) =>
                  setNewTimeSlot((prev) => ({ ...prev, endTime: e.target.value }))
                }
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="pollingInterval" className="block text-sm font-medium text-gray-700">
              轮询间隔
            </label>
            <select
              id="pollingInterval"
              value={newTimeSlot.pollingInterval}
              onChange={(e) =>
                setNewTimeSlot((prev) => ({
                  ...prev,
                  pollingInterval: Number(e.target.value) as PollingInterval,
                }))
              }
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {POLLING_INTERVALS.map((interval) => (
                <option key={interval.value} value={interval.value}>
                  {interval.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-sm text-gray-700 hover:text-gray-900"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleAdd}
              className="text-sm text-indigo-600 hover:text-indigo-900"
            >
              添加
            </button>
          </div>
        </div>
      )}
    </div>
  );
} 
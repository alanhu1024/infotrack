export interface TrackingTimeSlot {
  id: string;
  ruleId: string;
  startTime: string;
  endTime: string;
  pollingInterval: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TrackingRule {
  id: string;
  userId: string;
  name: string;
  description: string;
  criteria: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  twitterUsername: string;
  lastPolledAt: Date | null;
  pollingEnabled: boolean;
  pollingInterval: number;
  timeSlots: TrackingTimeSlot[];
} 
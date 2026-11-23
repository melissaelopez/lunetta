import type { WindowActivity } from './night-activity.js';
import type { SleepAnnotation } from '../types/app.js';
import type { NightSummary } from './sleep-scorer.js';
import type { DayStats } from './stats.js';
import type { BabyMilestones, Pronouns, Sleepwear } from './baby-context.js';
import type { NightInsights } from './ai-insights.js';
import type { VideoAnalysis } from './video-analysis.js';
import type { VideoPatternsResult } from './video-patterns.js';
import type { AudioAnalysis } from './audio-analysis.js';
import type { ScheduleRecommendation } from './schedule-optimizer.js';

export type CachedInsightValue = NightInsights | VideoAnalysis | VideoPatternsResult | AudioAnalysis | ScheduleRecommendation;

export interface BabySettings {
  baby_uid: string;
  name?: string;
  pronouns?: Pronouns;
  bedtime_hour?: number;
  wake_hour?: number;
  premature_weeks?: number;
  /** Custom normal night wake duration in minutes (null = use age-based default). */
  normal_wake_minutes?: number | null;
  /** Reusable custom sleep factor options added by parents (e.g. new sleep sacks). */
  custom_sleep_factors?: string[];
  milestones?: Partial<BabyMilestones>;
  sleepwear?: Sleepwear;
  pacifier?: boolean;
  notes?: string;
  updated_at: number;
}

export interface FeedbackEntry {
  message: string;
  email: string | null;
  page: string | null;
  kind: string;
  user_agent: string;
  created_at: number;
}

export interface PersistedChatMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
  model?: string;
}

export interface InsightsChatThread {
  baby_uid: string;
  night_date: string;
  messages: PersistedChatMessage[];
  updated_at: number;
}

export interface InsightsChatSummary {
  night_date: string;
  message_count: number;
  preview: string;
  updated_at: number;
}

export interface NightRecordSummary {
  date: string;
  score: number;
  longest_stretch_minutes: number;
  total_sleep_minutes: number;
}

export interface CachedSleepRecords {
  baby_uid: string;
  settings_key: string;
  nights: Record<string, NightRecordSummary>;
  empty_dates: string[];
  stale_dates: string[];
  scanned_back_to: string;
  latest_scanned_date: string;
  history_complete: boolean;
  updated_at: number;
}

export function summarizeChatThread(thread: InsightsChatThread): InsightsChatSummary {
  const userMsgs = thread.messages.filter(m => m.role === 'user');
  const source = userMsgs[userMsgs.length - 1] ?? thread.messages[thread.messages.length - 1];
  const raw = (source?.content ?? '').replace(/\s+/g, ' ').trim();
  const preview = raw.length > 96 ? `${raw.slice(0, 95)}…` : raw;
  return {
    night_date: thread.night_date,
    message_count: thread.messages.length,
    preview,
    updated_at: thread.updated_at,
  };
}

export interface Storage {
  getAnnotation(babyUid: string, nightKey: string): Promise<SleepAnnotation | null>;
  saveAnnotation(annotation: SleepAnnotation): Promise<void>;
  deleteAnnotation(babyUid: string, nightKey: string): Promise<void>;
  getBabySettings(babyUid: string): Promise<BabySettings | null>;
  saveBabySettings(settings: BabySettings): Promise<void>;
  getCachedInsight<T extends CachedInsightValue = NightInsights>(babyUid: string, nightKey: string): Promise<T | null>;
  cacheInsight(babyUid: string, nightKey: string, insights: CachedInsightValue): Promise<void>;
  getCachedNights(babyUid: string, start: number, end: number): Promise<NightSummary[] | null>;
  cacheNights(babyUid: string, start: number, end: number, nights: NightSummary[]): Promise<void>;
  getCachedActivity(babyUid: string, start: number, end: number): Promise<WindowActivity | null>;
  cacheActivity(babyUid: string, start: number, end: number, activity: WindowActivity): Promise<void>;
  getInsightsChat(babyUid: string, nightDate: string): Promise<InsightsChatThread | null>;
  saveInsightsChat(thread: InsightsChatThread): Promise<void>;
  deleteInsightsChat(babyUid: string, nightDate: string): Promise<void>;
  listInsightsChats(babyUid: string, limit?: number): Promise<InsightsChatSummary[]>;
  getSleepRecordsCache(babyUid: string): Promise<CachedSleepRecords | null>;
  saveSleepRecordsCache(records: CachedSleepRecords): Promise<void>;
  reserveAiCall(day: string, babyUid: string, label: string, perBabyLimit: number, globalLimit: number): Promise<'baby' | 'global' | null>;
  incrementStats(day: string, fields: Partial<Omit<DayStats, 'day'>>, babyUid?: string): Promise<void>;
  getStats(cutoff: string): Promise<DayStats[]>;
  addFeedback(entry: FeedbackEntry): Promise<string>;
  getFeedback(limit: number): Promise<Array<FeedbackEntry & { id: string }>>;
}

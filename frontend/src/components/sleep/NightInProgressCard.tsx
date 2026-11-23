import { useState, useEffect, useCallback } from 'react';
import { Moon, Activity, RefreshCw, TrendingUp, Sparkles, CheckCircle, AlertTriangle, Lightbulb } from 'lucide-react';
import { Card } from '../common/Card';
import { ErrorState } from '../common/ErrorState';
import { GeminiKeyInput } from '../common/GeminiKeyInput';
import { StatusChip } from '../common/StatusChip';
import { NightInsightsChat } from './NightInsightsChat';
import { rateTotalScore } from '../../utils/sleepRating';
import { errorMessage } from '../../utils/errors';
import { VideoAnalysisPanel } from './VideoAnalysisPanel';
import * as api from '../../services/api';
import { ApiRequestError, type NightInsights } from '../../services/api';
import { subscribeGeminiKey } from '../../utils/geminiKey';
import type { Baby, ScoredNight } from '../../types';

interface Props {
  baby: Baby | null;
  nightDate?: string;
  nightStart: number;
  nightEnd: number;
  prematureWeeks: number;
  bedtimeHour: number;
  wakeHour: number;
  normalWakeMinutes?: number | null;
  refreshKey?: number;
  onScoreLoaded?: (score: ScoredNight | null) => void;
  onSelectDate?: (date: string) => void;
}

interface LiveNightData {
  score: any | null;
  events: { motion: number; sound: number };
  elapsedMinutes: number;
  isAsleep: boolean;
  lastEventTime: number | null;
}

export function NightInProgressCard({ baby, nightDate, nightStart, nightEnd, prematureWeeks, bedtimeHour, wakeHour, normalWakeMinutes, refreshKey = 0, onScoreLoaded, onSelectDate }: Props) {
  const [data, setData] = useState<LiveNightData | null>(null);
  const [insights, setInsights] = useState<NightInsights | null>(null);
  const [insightsNeedsKey, setInsightsNeedsKey] = useState(false);
  const [insightsInvalidKey, setInsightsInvalidKey] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsRegenerating, setInsightsRegenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchData = useCallback(async () => {
    if (!baby) return;

    try {
      const [scores, msgs] = await Promise.all([
        api.getSleepScore(baby.uid, nightStart, nightEnd, baby.birthdate, prematureWeeks, bedtimeHour, normalWakeMinutes),
        api.getEvents(baby.uid, undefined, 50).catch(() => []),
      ]);
      setError(null);

      // Filter messages to tonight's window
      const tonightMsgs = msgs.filter(m => m.time >= nightStart && m.time <= nightEnd);
      const motion = tonightMsgs.filter(m => m.type === 'MOTION').length;
      const sound = tonightMsgs.filter(m => m.type === 'SOUND').length;
      const lastEvent = tonightMsgs.length > 0 ? Math.max(...tonightMsgs.map(m => m.time)) : null;

      const mainScore = scores.find(s => s.is_main) ?? scores[0] ?? null;
      onScoreLoaded?.(mainScore);

      const now = Math.floor(Date.now() / 1000);
      const elapsedMinutes = Math.round((now - nightStart) / 60);

      // Infer if baby is likely asleep based on recent event activity
      const recentWindow = now - 600; // last 10 minutes
      const recentEvents = tonightMsgs.filter(m => m.time >= recentWindow);
      const isAsleep = recentEvents.length <= 1; // 0-1 events in 10 min = likely asleep

      setData({
        score: mainScore,
        events: { motion, sound },
        elapsedMinutes,
        isAsleep,
        lastEventTime: lastEvent,
      });
      setLastRefresh(new Date());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [baby, nightStart, nightEnd, prematureWeeks, bedtimeHour, normalWakeMinutes, onScoreLoaded]);

  const fetchInsights = useCallback(async (force = false) => {
    if (!baby) return;
    if (force) {
      setInsightsRegenerating(true);
    } else {
      setInsightsLoading(true);
    }
    try {
      const result = await api.getInsights(baby.uid, nightStart, nightEnd, baby.birthdate, prematureWeeks, bedtimeHour, wakeHour, force);
      setInsightsNeedsKey(result.needsApiKey);
      setInsightsInvalidKey(false);
      setInsights(result.insights);
      setInsightsError(null);
    } catch (err) {
      setInsightsInvalidKey(err instanceof ApiRequestError && err.code === 'ai_invalid_key');
      setInsightsError(errorMessage(err));
    } finally {
      setInsightsLoading(false);
      setInsightsRegenerating(false);
    }
  }, [baby, nightStart, nightEnd, prematureWeeks, bedtimeHour, wakeHour]);

  // Fetch insights once score is available
  useEffect(() => {
    if (!baby || !data?.score) return;
    fetchInsights(false);
  }, [baby, data?.score?.total_score]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch when user updates their Gemini API key
  useEffect(() => {
    return subscribeGeminiKey(() => {
      if (baby && data?.score) fetchInsights(false);
    });
  }, [baby, data?.score, fetchInsights]);

  // Initial fetch + auto-refresh every 5 minutes
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData, refreshKey]);

  if (loading) {
    return (
      <Card title="Night in Progress" className="col-span-full">
        <div className="flex h-24 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      </Card>
    );
  }

  const formatDuration = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const formatTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const sleepMinutes = data?.score?.details?.total_sleep_minutes ?? 0;

  if (error && !data) {
    return (
      <Card title="Night in Progress" className="col-span-full">
        <ErrorState title="Couldn't load tonight from Nanit" message={error} onRetry={fetchData} />
      </Card>
    );
  }

  return (
    <Card
      title="Night in Progress"
      className="col-span-full border-indigo-500/30"
      action={
        <button onClick={fetchData} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300">
          <RefreshCw size={12} />
          {lastRefresh.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </button>
      }
    >
      <div className="space-y-4">
        {error && <ErrorState title="Last refresh failed" message={error} onRetry={fetchData} compact />}
        {/* Status banner */}
        <div className={`flex items-center gap-3 rounded-lg p-3 ${
          data?.isAsleep ? 'bg-indigo-50 dark:bg-indigo-950/50' : 'bg-amber-50 dark:bg-amber-950/50'
        }`}>
          <div className={`rounded-full p-2 ${
            data?.isAsleep ? 'bg-indigo-100 dark:bg-indigo-500/20' : 'bg-amber-100 dark:bg-amber-500/20'
          }`}>
            {data?.isAsleep ? (
              <Moon size={18} className="text-indigo-600 dark:text-indigo-400" />
            ) : (
              <Activity size={18} className="text-amber-600 dark:text-amber-400" />
            )}
          </div>
          <div>
            <p className={`text-sm font-medium ${
              data?.isAsleep ? 'text-indigo-800 dark:text-indigo-300' : 'text-amber-800 dark:text-amber-300'
            }`}>
              {data?.isAsleep ? 'Baby appears to be sleeping' : 'Baby appears to be awake'}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {data?.lastEventTime
                ? `Last activity: ${formatTime(data.lastEventTime)}`
                : 'No activity detected yet tonight'}
            </p>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="text-center">
            <p className="text-xs text-slate-500">Elapsed</p>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{formatDuration(data?.elapsedMinutes ?? 0)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500">Sleep so far</p>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{formatDuration(sleepMinutes)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500">Motion</p>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{data?.events.motion ?? 0}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500">Sound</p>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{data?.events.sound ?? 0}</p>
          </div>
        </div>

        {/* Running score */}
        {data?.score && (
          <div className="flex items-center gap-3 rounded-lg bg-slate-100 dark:bg-slate-900/50 p-3">
            <TrendingUp size={16} className="text-indigo-600 dark:text-indigo-400" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  Running score: <span className="font-semibold text-slate-900 dark:text-white">{data.score.total_score}/100</span>
                </p>
                <StatusChip tier={rateTotalScore(data.score.total_score)} />
                {data.score.details.wake_count > 0 && (
                  <span className="text-xs text-slate-600 dark:text-slate-400">({data.score.details.wake_count} wakes so far)</span>
                )}
              </div>
              {data.score.details.longest_stretch_minutes > 0 && (
                <p className="text-xs text-slate-500">
                  Longest stretch: {formatDuration(data.score.details.longest_stretch_minutes)}
                </p>
              )}
            </div>
          </div>
        )}

        {/* AI insights for tonight */}
        {(insightsLoading || insightsRegenerating || insights || insightsNeedsKey || insightsError) && (
          <div className="rounded-lg border border-indigo-200 dark:border-indigo-500/20 bg-indigo-50 dark:bg-indigo-950/20 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                <Sparkles size={11} />
                AI Insights
              </p>
              {insights && (
                <button
                  onClick={() => fetchInsights(true)}
                  disabled={insightsRegenerating}
                  className="flex items-center gap-1 text-[10px] text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 disabled:opacity-50"
                  title="Re-run Gemini analysis"
                >
                  <RefreshCw size={10} className={insightsRegenerating ? 'animate-spin' : ''} />
                  {insightsRegenerating ? 'Regenerating…' : 'Regenerate'}
                </button>
              )}
            </div>

            {(insightsLoading || insightsRegenerating) ? (
              <div className="flex items-center gap-2 py-1">
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {insightsRegenerating ? 'Regenerating insights with Gemini…' : "Analyzing tonight's sleep with Gemini…"}
                </p>
              </div>
            ) : insightsNeedsKey ? (
              <div className="space-y-2.5">
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Add your Gemini API key to get live AI insights for tonight.
                </p>
                <GeminiKeyInput compact />
              </div>
            ) : insightsError ? (
              <div className="space-y-2.5">
                <ErrorState title="Insights failed" message={insightsError} onRetry={() => fetchInsights(true)} compact />
                {insightsInvalidKey && <GeminiKeyInput compact />}
              </div>
            ) : insights && (
              <div className="space-y-2">
                <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">{insights.summary}</p>

                {(insights.keyFactors.positive.length > 0 || insights.keyFactors.negative.length > 0) && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {insights.keyFactors.positive.length > 0 && (
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Going well</p>
                        <ul className="space-y-0.5">
                          {insights.keyFactors.positive.map((item, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-[10px] text-emerald-800 dark:text-emerald-300/80">
                              <CheckCircle size={10} className="mt-0.5 shrink-0" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {insights.keyFactors.negative.length > 0 && (
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">Watch out for</p>
                        <ul className="space-y-0.5">
                          {insights.keyFactors.negative.map((item, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-[10px] text-amber-800 dark:text-amber-300/80">
                              <AlertTriangle size={10} className="mt-0.5 shrink-0" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {insights.video_analysis && <VideoAnalysisPanel analysis={insights.video_analysis} compact />}

                {insights.tip && (
                  <div className="flex items-start gap-1.5 rounded bg-indigo-50 dark:bg-indigo-950/40 p-2">
                    <Lightbulb size={11} className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-400" />
                    <p className="text-[10px] leading-relaxed text-indigo-800 dark:text-indigo-300">{insights.tip}</p>
                  </div>
                )}

                <NightInsightsChat
                  baby={baby}
                  nightDate={nightDate}
                  nightStart={nightStart}
                  nightEnd={nightEnd}
                  prematureWeeks={prematureWeeks}
                  bedtimeHour={bedtimeHour}
                  wakeHour={wakeHour}
                  currentInsights={insights}
                  compact
                  onSelectDate={onSelectDate}
                />
              </div>
            )}
          </div>
        )}

        <p className="text-[10px] text-slate-400 dark:text-slate-600">Auto-refreshes every 5 minutes. Click the refresh button for latest data.</p>
      </div>
    </Card>
  );
}

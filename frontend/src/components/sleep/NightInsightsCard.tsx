import { useState, useEffect, useCallback } from 'react';
import { Sparkles, CheckCircle, AlertTriangle, TrendingUp, Lightbulb, RefreshCw, KeyRound } from 'lucide-react';
import { Card } from '../common/Card';
import { GeminiKeyInput } from '../common/GeminiKeyInput';
import { NightInsightsChat } from './NightInsightsChat';
import { VideoAnalysisPanel } from './VideoAnalysisPanel';
import * as api from '../../services/api';
import { ApiRequestError, type NightInsights } from '../../services/api';
import { subscribeGeminiKey } from '../../utils/geminiKey';
import type { Baby } from '../../types';

interface Props {
  baby: Baby | null;
  nightDate?: string;
  nightStart: number;
  nightEnd: number;
  prematureWeeks: number;
  bedtimeHour: number;
  wakeHour: number;
  hasSleepData: boolean;
  annotationUpdatedAt?: number;
  onSelectDate?: (date: string) => void;
}

// Client-side cache to avoid re-fetching when navigating back
const insightsCache = new Map<string, NightInsights>();

export function NightInsightsCard({ baby, nightDate, nightStart, nightEnd, prematureWeeks, bedtimeHour, wakeHour, hasSleepData, annotationUpdatedAt = 0, onSelectDate }: Props) {
  const [insights, setInsights] = useState<NightInsights | null>(null);
  const [needsApiKey, setNeedsApiKey] = useState(false);
  const [invalidKey, setInvalidKey] = useState(false);
  const [showKeyPanel, setShowKeyPanel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInsights = useCallback(async (force = false) => {
    if (!baby || !hasSleepData || !nightStart) {
      setInsights(null);
      setNeedsApiKey(false);
      return;
    }

    const cacheKey = `${baby.uid}:${nightStart}:${annotationUpdatedAt}`;

    if (!force) {
      const cached = insightsCache.get(cacheKey);
      if (cached) {
        setInsights(cached);
        setNeedsApiKey(false);
        setInvalidKey(false);
        return;
      }
      setLoading(true);
    } else {
      insightsCache.delete(cacheKey);
      setRegenerating(true);
    }

    setError(null);
    setInvalidKey(false);

    try {
      const result = await api.getInsights(baby.uid, nightStart, nightEnd, baby.birthdate, prematureWeeks, bedtimeHour, wakeHour, force);
      if (result.needsApiKey) {
        setInsights(null);
        setNeedsApiKey(true);
        return;
      }
      setNeedsApiKey(false);
      setInsights(result.insights);
      if (result.insights) {
        insightsCache.set(cacheKey, result.insights);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to generate insights';
      const isBadKey = err instanceof ApiRequestError && err.code === 'ai_invalid_key';
      setInvalidKey(isBadKey);
      setError(message);
    } finally {
      setLoading(false);
      setRegenerating(false);
    }
  }, [baby, nightStart, nightEnd, prematureWeeks, bedtimeHour, wakeHour, hasSleepData, annotationUpdatedAt]);

  useEffect(() => {
    fetchInsights(false);
  }, [fetchInsights]);

  // Re-fetch automatically when the user adds, updates, or clears their Gemini API key
  useEffect(() => {
    return subscribeGeminiKey(() => {
      insightsCache.clear();
      setShowKeyPanel(false);
      fetchInsights(false);
    });
  }, [fetchInsights]);

  if (!hasSleepData) return null;

  if (loading) {
    return (
      <Card title="AI Insights" className="col-span-full">
        <div className="flex items-center gap-3 py-6">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          <p className="text-sm text-slate-600 dark:text-slate-400">Analyzing sleep data with Gemini…</p>
        </div>
      </Card>
    );
  }

  if (needsApiKey) {
    return (
      <Card
        title="AI Insights"
        className="col-span-full"
        action={<Sparkles size={16} className="text-indigo-600 dark:text-indigo-400" />}
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            AI Insights are powered by Google Gemini. Enter your own Gemini API key to analyze this night&apos;s sleep and camera activity.
          </p>
          <GeminiKeyInput compact />
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card
        title="AI Insights"
        className="col-span-full"
        action={
          <button
            onClick={() => fetchInsights(true)}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
          {invalidKey && <GeminiKeyInput compact />}
        </div>
      </Card>
    );
  }

  if (!insights || !insights.summary) return null;

  return (
    <Card
      title="AI Insights"
      className="col-span-full"
      action={
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowKeyPanel(v => !v)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            title="Manage Gemini API key"
          >
            <KeyRound size={12} />
            <span className="hidden sm:inline">Gemini key</span>
          </button>
          <button
            onClick={() => fetchInsights(true)}
            disabled={regenerating}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 disabled:opacity-50"
            title="Re-run Gemini analysis"
          >
            <RefreshCw size={12} className={regenerating ? 'animate-spin' : ''} />
            {regenerating ? 'Regenerating…' : 'Regenerate'}
          </button>
          <Sparkles size={16} className="text-indigo-600 dark:text-indigo-400" />
        </div>
      }
    >
      {showKeyPanel && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50">
          <GeminiKeyInput compact onSaved={() => setShowKeyPanel(false)} />
        </div>
      )}
      {regenerating ? (
        <div className="flex items-center gap-3 py-6">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          <p className="text-sm text-slate-600 dark:text-slate-400">Regenerating insights with Gemini…</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Summary */}
          <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{insights.summary}</p>

          {/* Key Factors */}
          {(insights.keyFactors.positive.length > 0 || insights.keyFactors.negative.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {insights.keyFactors.positive.length > 0 && (
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 p-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">What went well</p>
                  <ul className="space-y-1">
                    {insights.keyFactors.positive.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-emerald-800 dark:text-emerald-300/80">
                        <CheckCircle size={12} className="mt-0.5 shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {insights.keyFactors.negative.length > 0 && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">What hurt the score</p>
                  <ul className="space-y-1">
                    {insights.keyFactors.negative.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300/80">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Comparison */}
          {insights.comparison && (
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">{insights.comparison}</p>
          )}

          {/* Patterns */}
          {insights.patterns.length > 0 && (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                <TrendingUp size={12} />
                Patterns
              </p>
              <ul className="space-y-1">
                {insights.patterns.map((p, i) => (
                  <li key={i} className="text-xs text-slate-600 dark:text-slate-400">- {p}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Video Analysis — structured insights from camera */}
          {insights.video_analysis && <VideoAnalysisPanel analysis={insights.video_analysis} />}

          {/* Legacy text-only video observations (for old cached insights) */}
          {!insights.video_analysis && insights.video_observations && insights.video_observations.length > 0 && (
            <div className="rounded-lg border border-violet-200 dark:border-violet-500/20 bg-violet-50 dark:bg-violet-950/20 p-3">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">Video observations</p>
              <ul className="space-y-1">
                {insights.video_observations.map((obs, i) => (
                  <li key={i} className="text-xs text-slate-600 dark:text-slate-400">- {obs}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Tip */}
          {insights.tip && (
            <div className="flex items-start gap-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 p-3">
              <Lightbulb size={14} className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-400" />
              <p className="text-xs leading-relaxed text-indigo-800 dark:text-indigo-300">{insights.tip}</p>
            </div>
          )}

          {/* Follow-up chat with Gemini */}
          <NightInsightsChat
            baby={baby}
            nightDate={nightDate}
            nightStart={nightStart}
            nightEnd={nightEnd}
            prematureWeeks={prematureWeeks}
            bedtimeHour={bedtimeHour}
            wakeHour={wakeHour}
            currentInsights={insights}
            onSelectDate={onSelectDate}
          />
        </div>
      )}
    </Card>
  );
}

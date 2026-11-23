import { useEffect, useState } from 'react';
import { Award, Hourglass, Moon, RefreshCw } from 'lucide-react';
import { DateTime } from 'luxon';
import { Card } from '../common/Card';
import { ErrorState } from '../common/ErrorState';
import { StatusChip } from '../common/StatusChip';
import { errorMessage } from '../../utils/errors';
import { formatDuration } from '../../utils/date';
import { rateTotalScore } from '../../utils/sleepRating';
import * as api from '../../services/api';
import type { AllTimeSleepRecords } from '../../services/api';
import type { Baby } from '../../types';

interface Props {
  baby: Baby | null;
  bedtimeHour: number;
  wakeHour: number;
  prematureWeeks: number;
  refreshKey?: number;
  onSelectDate?: (date: string) => void;
}

function formatRecordDate(iso: string): string {
  const dt = DateTime.fromISO(iso);
  if (!dt.isValid) return iso;
  const sameYear = dt.year === DateTime.now().year;
  return dt.toFormat(sameYear ? 'MMM d' : 'MMM d, yyyy');
}

export function AllTimeRecordsCard({
  baby,
  bedtimeHour,
  wakeHour,
  prematureWeeks,
  refreshKey = 0,
  onSelectDate,
}: Props) {
  const [records, setRecords] = useState<AllTimeSleepRecords | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [forceNext, setForceNext] = useState(false);

  useEffect(() => {
    if (!baby) return;
    let cancelled = false;
    const isForce = forceNext;
    if (isForce) {
      setRefreshing(true);
      setForceNext(false);
    } else {
      setLoading(true);
    }
    setError(null);

    api.getAllTimeSleepRecords(baby.uid, baby.birthdate, prematureWeeks, bedtimeHour, wakeHour, isForce)
      .then(data => {
        if (!cancelled) setRecords(data);
      })
      .catch(err => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baby, bedtimeHour, wakeHour, prematureWeeks, refreshKey, reloadCount]);

  const handleRefresh = () => {
    setForceNext(true);
    setReloadCount(c => c + 1);
  };

  if (error && !records && !loading) {
    return (
      <Card title="All-Time Highs" className="col-span-full">
        <ErrorState message={error} onRetry={() => setReloadCount(c => c + 1)} compact />
      </Card>
    );
  }

  const subtitle = records && records.nights_analyzed > 0
    ? `Across ${records.nights_analyzed} night${records.nights_analyzed === 1 ? '' : 's'}${
        records.earliest_date ? ` · since ${formatRecordDate(records.earliest_date)}` : ''
      }`
    : null;

  const renderDateButton = (date: string) => {
    const label = formatRecordDate(date);
    if (!onSelectDate) {
      return <span className="text-[11px] text-slate-500 dark:text-indigo-200/60">{label}</span>;
    }
    return (
      <button
        type="button"
        onClick={() => onSelectDate(date)}
        title={`Jump to night of ${label}`}
        className="text-[11px] font-medium text-indigo-600 underline decoration-indigo-300 underline-offset-2 transition hover:text-indigo-500 dark:text-indigo-300 dark:decoration-indigo-500/40 dark:hover:text-indigo-200"
      >
        {label}
      </button>
    );
  };

  return (
    <Card
      title="All-Time Highs"
      className="col-span-full"
      action={
        <div className="flex items-center gap-2">
          {subtitle && (
            <span className="hidden text-[11px] text-slate-400 dark:text-indigo-200/50 sm:inline">
              {subtitle}
            </span>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading || refreshing}
            title="Refresh all-time highs"
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-slate-400 transition hover:text-slate-600 disabled:opacity-40 dark:text-indigo-300/60 dark:hover:text-indigo-200"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">{refreshing ? 'Updating…' : 'Refresh'}</span>
          </button>
        </div>
      }
    >
      {loading && !records ? (
        <div className="flex items-center justify-center gap-2.5 py-6">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          <p className="text-xs text-slate-500 dark:text-indigo-200/60">Scanning sleep history…</p>
        </div>
      ) : !records || records.nights_analyzed === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">No completed nights recorded yet</p>
      ) : (
        <div className="space-y-2.5">
          {subtitle && (
            <p className="text-[11px] text-slate-400 dark:text-indigo-200/50 sm:hidden">{subtitle}</p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {/* Highest Sleep Score */}
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-3.5 dark:border-indigo-900/50 dark:bg-[#0e102b]/80">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-indigo-200/65">
                  <Award size={13} className="text-indigo-500 dark:text-indigo-400" />
                  Sleep Score
                </span>
                {records.highest_score && (
                  <StatusChip tier={rateTotalScore(records.highest_score.value)} />
                )}
              </div>
              {records.highest_score ? (
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                    {records.highest_score.value}
                    <span className="ml-0.5 text-xs font-normal text-slate-400 dark:text-indigo-300/50">/100</span>
                  </p>
                  {renderDateButton(records.highest_score.date)}
                </div>
              ) : (
                <p className="text-lg font-semibold text-slate-400">—</p>
              )}
            </div>

            {/* Longest Stretch */}
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-3.5 dark:border-indigo-900/50 dark:bg-[#0e102b]/80">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-indigo-200/65">
                <Hourglass size={13} className="text-teal-600 dark:text-teal-400" />
                Longest Stretch
              </div>
              {records.longest_stretch_minutes ? (
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                    {formatDuration(records.longest_stretch_minutes.value)}
                  </p>
                  {renderDateButton(records.longest_stretch_minutes.date)}
                </div>
              ) : (
                <p className="text-lg font-semibold text-slate-400">—</p>
              )}
            </div>

            {/* Most Sleep Hours */}
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-3.5 dark:border-indigo-900/50 dark:bg-[#0e102b]/80">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-indigo-200/65">
                <Moon size={13} className="text-violet-500 dark:text-violet-400" />
                Sleep Hours
              </div>
              {records.most_sleep_minutes ? (
                <div className="flex items-baseline justify-between gap-2">
                  <p className="flex items-baseline gap-1.5 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                    {formatDuration(records.most_sleep_minutes.value)}
                    <span className="text-xs font-normal text-slate-400 dark:text-indigo-300/50">
                      ({(records.most_sleep_minutes.value / 60).toFixed(1)}h)
                    </span>
                  </p>
                  {renderDateButton(records.most_sleep_minutes.date)}
                </div>
              ) : (
                <p className="text-lg font-semibold text-slate-400">—</p>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

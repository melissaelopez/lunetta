import { useState, type ReactNode } from 'react';
import { Card } from '../common/Card';
import { ScoreRing } from '../common/ScoreRing';
import { StatusChip } from '../common/StatusChip';
import { formatTime, formatDuration } from '../../utils/date';
import {
  getTierMeta,
  rateContinuity,
  rateDuration,
  rateStretch,
  rateTiming,
  rateTotalScore,
  rateWakeTime,
  type SleepTier,
} from '../../utils/sleepRating';
import { Moon, Sun, Eye, Timer, Hourglass, ChevronDown, ChevronUp, Gauge } from 'lucide-react';
import type { SleepScoreBreakdown } from '../../types';

interface Props {
  score: SleepScoreBreakdown | null;
  loading?: boolean;
  babyName?: string;
  wakeHour?: number;
  onOpenSettings?: () => void;
}

interface MetricTileProps {
  icon: ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  tier?: SleepTier | null;
}

function MetricTile({ icon, label, value, sub, tier }: MetricTileProps) {
  return (
    <div className="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-indigo-900/50 dark:bg-[#181c42]/90">
      <div>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-indigo-200/70">
          <span className="text-slate-400 dark:text-indigo-300/80">{icon}</span>
          <span>{label}</span>
        </div>
        <p className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
          {value}
        </p>
        {sub && (
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-indigo-200/60">{sub}</p>
        )}
      </div>
      {tier && (
        <div className="mt-2.5">
          <StatusChip tier={tier} />
        </div>
      )}
    </div>
  );
}

export function SleepScoreCard({ score, loading, babyName, wakeHour, onOpenSettings }: Props) {
  const [showWhy, setShowWhy] = useState(false);

  if (loading) {
    return (
      <Card title="Sleep Score" className="col-span-full lg:col-span-2">
        <div className="flex h-48 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      </Card>
    );
  }

  if (!score) {
    return (
      <Card title="Sleep Score" className="col-span-full lg:col-span-2">
        <p className="py-8 text-center text-sm text-slate-400">No sleep data for this date</p>
      </Card>
    );
  }

  const d = score.details;
  const x = score.expectations;
  const overallTier = rateTotalScore(score.total_score);
  const overallMeta = getTierMeta(overallTier);
  const durationTier = rateDuration(score.duration_score);
  const continuityTier = rateContinuity(score.continuity_score);
  const stretchTier = rateStretch(score.onset_score);
  const timingTier = rateTiming(score.timing_score);
  const wakeTier = typeof wakeHour === 'number' ? rateWakeTime(d.wake_time, wakeHour) : null;

  const trimmedName = babyName?.trim();
  const headline = trimmedName
    ? `${trimmedName} had ${overallMeta.headlinePhrase}`
    : `${overallMeta.label} night`;

  const fmtHour = (h: number) => {
    const whole = Math.floor(h);
    const mins = Math.round((h - whole) * 60);
    const ampm = whole >= 12 ? 'PM' : 'AM';
    const h12 = whole % 12 === 0 ? 12 : whole % 12;
    return mins ? `${h12}:${String(mins).padStart(2, '0')} ${ampm}` : `${h12} ${ampm}`;
  };
  const settled = x?.self_settled_wakes ?? 0;
  const visited = x?.parent_visit_wakes ?? 0;
  const hasVisitData = x?.self_settled_wakes !== undefined && d.wake_count > (x.unknown_wakes ?? 0);

  const why = x ? [
    {
      label: 'Duration',
      value: score.duration_score, max: 35,
      tier: durationTier,
      note: `${formatDuration(d.total_sleep_minutes)} of an ideal ${x.ideal_sleep_hours}h for ${x.adjusted_age_months} mo adjusted (${Math.round((d.total_sleep_minutes / (x.ideal_sleep_hours * 60)) * 100)}%)`,
    },
    {
      label: 'Continuity',
      value: score.continuity_score, max: 35,
      tier: continuityTier,
      note: `${d.wake_count} wake${d.wake_count === 1 ? '' : 's'}` +
        (hasVisitData ? ` (${settled} self-settled, ${visited} with a parent visit${x.unknown_wakes ? `, ${x.unknown_wakes} unknown` : ''})` : '') +
        `, ${x.expected_wakes} needing a parent expected at this age (−${x.excess_wake_penalty})` +
        (x.long_wake_penalty > 0
          ? `; wakes longer than ${x.normal_wake_minutes} min${x.normal_wake_minutes_custom ? ' (your setting)' : ''} cost −${x.long_wake_penalty}`
          : `; none ran past ${x.normal_wake_minutes} min${x.normal_wake_minutes_custom ? ' (your setting)' : ''}`),
    },
    {
      label: 'Stretch',
      value: score.onset_score, max: 15,
      tier: stretchTier,
      note: `Longest ${formatDuration(d.longest_stretch_minutes)} vs ${x.expected_stretch_hours}h expected (excludes self-settled wakes)`,
    },
    {
      label: 'Timing',
      value: score.timing_score, max: 15,
      tier: timingTier,
      note: `Asleep at ${formatTime(d.bedtime)}; ideal window ${fmtHour(x.ideal_bedtime_range[0])}–${fmtHour(x.ideal_bedtime_range[1])}`,
    },
  ] : [];

  return (
    <div className="col-span-full space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-indigo-900/50 dark:bg-[#131636] sm:p-5 lg:col-span-2">
      {/* Night headline */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white sm:text-xl">
          {headline}
        </h2>
        {d.adjusted && (
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
            Adjusted
          </span>
        )}
      </div>

      {/* Twilight Sleep Score Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#2b3f8c] via-[#342f78] to-[#1d1c4d] px-5 py-4 text-white shadow-inner dark:from-[#1d2e70] dark:via-[#292363] dark:to-[#171640]">
        {/* Subtle decorative stars & twilight hills */}
        <svg
          aria-hidden="true"
          viewBox="0 0 400 120"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full opacity-25"
        >
          <circle cx="48" cy="24" r="1.5" fill="white" />
          <circle cx="132" cy="18" r="1.2" fill="white" />
          <circle cx="205" cy="34" r="1.8" fill="white" />
          <circle cx="268" cy="16" r="1.1" fill="white" />
          <circle cx="355" cy="28" r="1.4" fill="white" />
          <path
            d="M0 105 Q70 72 150 96 T310 88 T400 102 L400 120 L0 120 Z"
            fill="#0b0d24"
            opacity="0.55"
          />
        </svg>

        <div className="relative flex items-center justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-100/80">
              <Gauge size={13} />
              <span>Sleep Score</span>
            </div>
            <p className="max-w-[220px] text-sm leading-snug text-indigo-50/95">
              {overallMeta.subtitle}
            </p>
          </div>
          <ScoreRing score={score.total_score} size={108} strokeWidth={7} label={overallMeta.label} onDarkBanner />
        </div>
      </div>

      {/* Elevated Top-Level Metric Tiles with Status Chips */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
        <MetricTile
          icon={<Moon size={13} />}
          label="Bedtime"
          value={formatTime(d.bedtime)}
          sub={d.custom_bedtime ? `Adjusted: ${formatTime(d.custom_bedtime)}` : undefined}
          tier={timingTier}
        />
        <MetricTile
          icon={<Sun size={13} />}
          label="Wake time"
          value={formatTime(d.wake_time)}
          sub={d.custom_wake_time ? `Adjusted: ${formatTime(d.custom_wake_time)}` : undefined}
          tier={wakeTier}
        />
        <MetricTile
          icon={<Timer size={13} />}
          label="Total sleep"
          value={formatDuration(d.total_sleep_minutes)}
          sub={`Target: ${formatDuration(d.target_sleep_minutes)}`}
          tier={durationTier}
        />
        <MetricTile
          icon={<Hourglass size={13} />}
          label="Longest stretch"
          value={formatDuration(d.longest_stretch_minutes)}
          sub={x ? `Expected: ${x.expected_stretch_hours}h` : undefined}
          tier={stretchTier}
        />
        <MetricTile
          icon={<Eye size={13} />}
          label="Wake-ups"
          value={d.wake_count}
          sub={
            hasVisitData && d.wake_count > 0
              ? (settled > 0 ? `${settled} self-settled` : `${visited} parent visit${visited === 1 ? '' : 's'}`)
              : d.wake_count === 0
                ? 'Slept through'
                : undefined
          }
          tier={continuityTier}
        />
      </div>

      {/* Sub-score breakdown */}
      <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3.5 dark:border-indigo-900/50 sm:grid-cols-4">
        {[
          { label: 'Duration', value: score.duration_score, max: 35, tier: durationTier },
          { label: 'Continuity', value: score.continuity_score, max: 35, tier: continuityTier },
          { label: 'Stretch', value: score.onset_score, max: 15, tier: stretchTier },
          { label: 'Timing', value: score.timing_score, max: 15, tier: timingTier },
        ].map(({ label, value, max, tier }) => (
          <div key={label} className="text-center">
            <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500 dark:text-indigo-200/70">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${getTierMeta(tier).dotClass}`} />
              {label}
            </p>
            <p className="text-sm font-semibold text-slate-700 dark:text-white">
              {value}<span className="text-xs font-normal text-slate-400 dark:text-indigo-300/50">/{max}</span>
            </p>
          </div>
        ))}
      </div>

      {/* Expandable explanation */}
      {why.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowWhy(v => !v)}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
          >
            {showWhy ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Why this score?
          </button>
          {showWhy && (
            <ul className="mt-2 space-y-1.5 rounded-xl bg-slate-50 p-3 dark:bg-[#0e102b]/80">
              {why.map(w => (
                <li key={w.label} className="text-xs text-slate-600 dark:text-slate-300">
                  <span className="font-medium text-slate-700 dark:text-white">{w.label} {w.value}/{w.max}</span>
                  <span className="mx-1 text-slate-400">·</span>{w.note}
                </li>
              ))}
              <li className="pt-1 text-[10px] text-slate-400 dark:text-indigo-200/60">
                Expectations come from an age table (adjusted for prematurity) and your settings. Expected wakes at this age are free; only extra or unusually long ones cost points. Wakes the baby settled from without a parent visit (camera detects approaches to the crib) never count as extra, and running long costs half. Need more time for night feeds or holding baby upright? Adjust <strong>Normal wake length</strong> in{' '}
                {onOpenSettings ? (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="font-medium text-indigo-600 underline hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
                  >
                    Settings
                  </button>
                ) : (
                  <span>Settings (gear icon)</span>
                )}
                .
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

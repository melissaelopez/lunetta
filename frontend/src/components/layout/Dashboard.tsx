import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Settings, Moon, Clock, Sparkles, TrendingUp, Video, Loader2, History } from 'lucide-react';
import { DateTime } from 'luxon';
import { Nav } from './Nav';
import { SettingsPanel } from './SettingsPanel';
import { SleepScoreCard } from '../sleep/SleepScoreCard';
import { SleepTimeline } from '../sleep/SleepTimeline';
import { NightAdjustCard } from '../sleep/NightAdjustCard';
import { DayActivityCard } from '../sleep/DayActivityCard';
import { ErrorState } from '../common/ErrorState';
import { SectionCarouselTabs, type CarouselTab } from '../common/SectionCarouselTabs';
import { errorMessage } from '../../utils/errors';
import { SleepTrendChart } from '../sleep/SleepTrendChart';
import { AllTimeRecordsCard } from '../sleep/AllTimeRecordsCard';
import { NightInsightsCard } from '../sleep/NightInsightsCard';
import { NightInProgressCard } from '../sleep/NightInProgressCard';
import { VideoEventsCard } from '../sleep/VideoEventsCard';
import { VideoPatternsCard } from '../sleep/VideoPatternsCard';
import { MilestonesCard } from '../sleep/MilestonesCard';
import { SleepFactorsCard } from '../sleep/SleepFactorsCard';
import { RegressionAlertsBanner } from '../sleep/RegressionAlertsBanner';
import { ScheduleOptimizerCard } from '../sleep/ScheduleOptimizerCard';
import { NightComparisonCard } from '../sleep/NightComparisonCard';
import { EventsCard } from '../sensors/EventsCard';
import { CareCard } from '../care/CareCard';
import * as api from '../../services/api';
import { formatAge, yesterdayStr, dayStart, dayEnd } from '../../utils/date';
import { useSettings, nightWindow, adjustedAgeMonths, activeNightDate, formatHourLabel } from '../../hooks/useSettings';
import type { Baby, CalendarEvent, NanitMessage, ScoredNight } from '../../types';

export function Dashboard() {
  const [baby, setBaby] = useState<Baby | null>(null);
  const [date, setDate] = useState(yesterdayStr());
  const [sleepScore, setSleepScore] = useState<ScoredNight | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [careEvents, setCareEvents] = useState<CalendarEvent[]>([]);
  const [allTypes, setAllTypes] = useState<string[]>([]);
  const [messages, setMessages] = useState<NanitMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastNightDate, setLastNightDate] = useState<string | null>(null);
  const [findingLastNight, setFindingLastNight] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState('timeline');
  const [tonightTab, setTonightTab] = useState('timeline');
  const [liveScore, setLiveScore] = useState<ScoredNight | null>(null);
  const { settings, setSettings } = useSettings(baby?.uid);

  // Determine which night (if any) is currently in progress right now.
  // Between midnight and wakeHour, the in-progress night is yesterday's date (e.g. at 4 AM on Nov 22, it's Night of Nov 21).
  const currentLiveNight = activeNightDate(settings);
  const maxDate = currentLiveNight ?? yesterdayStr();
  const effectiveDate = date > maxDate ? maxDate : date;
  const nw = nightWindow(effectiveDate, settings);
  const isNightInProgress = currentLiveNight !== null && effectiveDate === currentLiveNight;

  // Load baby on mount
  useEffect(() => {
    api.getBabies().then(babies => {
      if (babies?.length > 0) setBaby(babies[0]);
    }).catch(console.error);
  }, []);

  // Discover the most recent completed night that actually has sleep data (excluding any live night in progress)
  const fallbackLastNight = currentLiveNight
    ? DateTime.fromISO(currentLiveNight).minus({ days: 1 }).toFormat('yyyy-MM-dd')
    : yesterdayStr();

  const resolveLastNightWithData = useCallback(async (b: Baby): Promise<string> => {
    try {
      const recent = await api.getSleepTrend(b.uid, b.birthdate, 14, settings.bedtimeHour, settings.wakeHour, settings.prematureWeeks);
      for (let i = recent.length - 1; i >= 0; i--) {
        if (recent[i].score !== null && recent[i].date !== currentLiveNight) return recent[i].date;
      }
    } catch {
      // Fall back if trend lookup fails
    }
    return fallbackLastNight;
  }, [settings.bedtimeHour, settings.wakeHour, settings.prematureWeeks, currentLiveNight, fallbackLastNight]);

  useEffect(() => {
    if (!baby) return;
    let cancelled = false;
    resolveLastNightWithData(baby).then(found => {
      if (!cancelled) setLastNightDate(found);
    });
    return () => { cancelled = true; };
  }, [baby, resolveLastNightWithData]);

  // Load history data when baby, date, or settings change (skip for in-progress night — NightInProgressCard self-fetches)
  useEffect(() => {
    if (!baby || isNightInProgress) return;
    setLoading(true);

    const start = dayStart(effectiveDate);
    const end = dayEnd(effectiveDate);

    setScoreError(null);

    Promise.all([
      api.getSleepScore(baby.uid, nw.start, nw.end, baby.birthdate, settings.prematureWeeks, settings.bedtimeHour, settings.normalWakeMinutes)
        .then(scores => {
          const main = scores.find(s => s.is_main) ?? scores[0] ?? null;
          setSleepScore(main);
          if (main && effectiveDate !== currentLiveNight && (!lastNightDate || effectiveDate > lastNightDate) && effectiveDate <= maxDate) {
            setLastNightDate(effectiveDate);
          }
        })
        .catch(err => {
          setSleepScore(null);
          setScoreError(errorMessage(err));
        }),
      // Care and sensor events are secondary; an outage there shouldn't blank the page
      api.getCareEvents(baby.uid, start, end).catch(() => ({ events: [], all_types: [] })),
      api.getEvents(baby.uid, undefined, 200).catch(() => []),
    ]).then(([, care, msgs]) => {
      setCareEvents(care.events);
      setAllTypes(care.all_types);
      const filtered = msgs.filter((m: NanitMessage) => m.time >= start && m.time <= end);
      setMessages(filtered);
    }).finally(() => setLoading(false));
  }, [baby, effectiveDate, settings, isNightInProgress, refreshKey]);

  const refetch = () => setRefreshKey(k => k + 1);

  const prevDay = () => {
    setDate(DateTime.fromISO(effectiveDate).minus({ days: 1 }).toFormat('yyyy-MM-dd'));
  };

  const nextDay = () => {
    const next = DateTime.fromISO(effectiveDate).plus({ days: 1 });
    if (next.toFormat('yyyy-MM-dd') <= maxDate) {
      setDate(next.toFormat('yyyy-MM-dd'));
    }
  };

  const goToLastNight = async () => {
    if (lastNightDate) {
      setDate(lastNightDate);
      return;
    }
    if (!baby) {
      setDate(fallbackLastNight);
      return;
    }
    setFindingLastNight(true);
    try {
      const found = await resolveLastNightWithData(baby);
      setLastNightDate(found);
      setDate(found);
    } finally {
      setFindingLastNight(false);
    }
  };

  const goToTonight = () => {
    if (currentLiveNight) setDate(currentLiveNight);
  };

  const bedtimeLabel = formatHourLabel(settings.bedtimeHour);

  const isOnLastNight = effectiveDate === (lastNightDate ?? fallbackLastNight);
  const isLatest = effectiveDate >= maxDate;
  const displayDate = DateTime.fromISO(effectiveDate).toFormat('EEE, MMM d');

  const tonightTabs: CarouselTab[] = [
    {
      id: 'timeline',
      label: 'Timeline',
      icon: <Clock size={14} />,
      content: (
        <SleepTimeline sleepScore={liveScore} baby={baby} onSaved={refetch} />
      ),
    },
    {
      id: 'analysis',
      label: 'Analysis',
      icon: <Sparkles size={14} />,
      content: (
        <>
          <DayActivityCard baby={baby} prematureWeeks={settings.prematureWeeks} bedtimeHour={settings.bedtimeHour} wakeHour={settings.wakeHour} />
          <VideoPatternsCard baby={baby} prematureWeeks={settings.prematureWeeks} bedtimeHour={settings.bedtimeHour} wakeHour={settings.wakeHour} />
        </>
      ),
    },
    {
      id: 'trends',
      label: 'Trends',
      icon: <TrendingUp size={14} />,
      content: (
        <>
          <AllTimeRecordsCard
            baby={baby}
            bedtimeHour={settings.bedtimeHour}
            wakeHour={settings.wakeHour}
            prematureWeeks={settings.prematureWeeks}
            refreshKey={refreshKey}
            onSelectDate={setDate}
          />
          <SleepTrendChart baby={baby} bedtimeHour={settings.bedtimeHour} wakeHour={settings.wakeHour} prematureWeeks={settings.prematureWeeks} />
          <ScheduleOptimizerCard
            baby={baby}
            prematureWeeks={settings.prematureWeeks}
            bedtimeHour={settings.bedtimeHour}
            wakeHour={settings.wakeHour}
            onApply={(bedtime, wake) => setSettings({ bedtimeHour: bedtime, wakeHour: wake })}
          />
        </>
      ),
    },
    {
      id: 'events',
      label: 'Events',
      icon: <Video size={14} />,
      content: (
        <VideoEventsCard
          baby={baby}
          prematureWeeks={settings.prematureWeeks}
          nightStart={nw.start}
          nightEnd={nw.end}
          nightLabel={displayDate}
        />
      ),
    },
  ];

  const historyTabs: CarouselTab[] = [
    {
      id: 'timeline',
      label: 'Timeline',
      icon: <Clock size={14} />,
      content: (
        <>
          <SleepTimeline sleepScore={sleepScore} loading={loading} baby={baby} onSaved={refetch} />
          <NightAdjustCard baby={baby} night={sleepScore} loading={loading} onSaved={refetch} />
        </>
      ),
    },
    {
      id: 'analysis',
      label: 'Analysis',
      icon: <Sparkles size={14} />,
      content: (
        <>
          <DayActivityCard baby={baby} prematureWeeks={settings.prematureWeeks} bedtimeHour={settings.bedtimeHour} wakeHour={settings.wakeHour} />
          <NightInsightsCard
            baby={baby}
            nightDate={effectiveDate}
            nightStart={nw.start}
            nightEnd={nw.end}
            prematureWeeks={settings.prematureWeeks}
            bedtimeHour={settings.bedtimeHour}
            wakeHour={settings.wakeHour}
            hasSleepData={!!sleepScore}
            annotationUpdatedAt={sleepScore?.annotation?.updated_at}
            onSelectDate={setDate}
          />
          <NightComparisonCard
            baby={baby}
            prematureWeeks={settings.prematureWeeks}
            bedtimeHour={settings.bedtimeHour}
            wakeHour={settings.wakeHour}
          />
          <VideoPatternsCard baby={baby} prematureWeeks={settings.prematureWeeks} bedtimeHour={settings.bedtimeHour} wakeHour={settings.wakeHour} />
        </>
      ),
    },
    {
      id: 'trends',
      label: 'Trends',
      icon: <TrendingUp size={14} />,
      content: (
        <>
          <AllTimeRecordsCard
            baby={baby}
            bedtimeHour={settings.bedtimeHour}
            wakeHour={settings.wakeHour}
            prematureWeeks={settings.prematureWeeks}
            refreshKey={refreshKey}
            onSelectDate={setDate}
          />
          <SleepTrendChart baby={baby} bedtimeHour={settings.bedtimeHour} wakeHour={settings.wakeHour} prematureWeeks={settings.prematureWeeks} />
          <ScheduleOptimizerCard
            baby={baby}
            prematureWeeks={settings.prematureWeeks}
            bedtimeHour={settings.bedtimeHour}
            wakeHour={settings.wakeHour}
            onApply={(bedtime, wake) => setSettings({ bedtimeHour: bedtime, wakeHour: wake })}
          />
        </>
      ),
    },
    {
      id: 'events',
      label: 'Events',
      icon: <Video size={14} />,
      content: (
        <>
          <VideoEventsCard
            baby={baby}
            prematureWeeks={settings.prematureWeeks}
            nightStart={nw.start}
            nightEnd={nw.end}
            nightLabel={displayDate}
          />
          <CareCard events={careEvents} allTypes={allTypes} loading={loading} />
        </>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0b0d24]">
      <Nav />
      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* Header */}
        <div className="mb-6 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              {baby && (
                <>
                  <h1 className="text-xl font-bold text-slate-800 dark:text-white sm:text-2xl">{baby.name}</h1>
                  <p className="text-xs text-slate-500 dark:text-slate-400 sm:text-sm">
                    {formatAge(baby.birthdate)} old
                    {settings.prematureWeeks > 0 && (
                      <span className="ml-1.5 text-indigo-400">
                        (adj: {Math.round(adjustedAgeMonths(baby.birthdate, settings.prematureWeeks) * 10) / 10}m)
                      </span>
                    )}
                  </p>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSettingsOpen(true)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
                title="Sleep settings"
              >
                <Settings size={18} />
              </button>
              <button
                type="button"
                onClick={goToLastNight}
                disabled={findingLastNight}
                title={lastNightDate ? `Jump to most recent completed night with data (${DateTime.fromISO(lastNightDate).toFormat('EEE, MMM d')})` : 'Jump to most recent completed night with data'}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-60 ${
                  isOnLastNight
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-200 text-slate-600 hover:bg-slate-300 dark:bg-indigo-950/70 dark:text-indigo-200 dark:hover:bg-indigo-900/70'
                }`}
              >
                {findingLastNight ? <Loader2 size={14} className="animate-spin" /> : <History size={14} />}
                Last Night
              </button>
              <button
                type="button"
                onClick={goToTonight}
                disabled={!currentLiveNight}
                title={currentLiveNight ? `View night in progress (${DateTime.fromISO(currentLiveNight).toFormat('EEE, MMM d')})` : `No night in progress yet (starts at ${bedtimeLabel})`}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  isNightInProgress
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-200 text-slate-600 hover:bg-slate-300 dark:bg-indigo-950/70 dark:text-indigo-200 dark:hover:bg-indigo-900/70'
                }`}
              >
                <Moon size={14} />
                Tonight
              </button>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2">
            <button onClick={prevDay} className="rounded-lg p-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800">
              <ChevronLeft size={20} />
            </button>
            <span className="min-w-[160px] text-center text-sm font-medium text-slate-700 dark:text-slate-300">
              Night of {displayDate}
              {isNightInProgress && <span className="ml-1.5 rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] text-indigo-400">LIVE</span>}
            </span>
            <button
              onClick={nextDay}
              disabled={isLatest}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-200 disabled:opacity-30 dark:hover:bg-slate-800"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        {/* Regression alerts banner — shows across all modes */}
        <RegressionAlertsBanner
          baby={baby}
          prematureWeeks={settings.prematureWeeks}
          bedtimeHour={settings.bedtimeHour}
          wakeHour={settings.wakeHour}
        />

        {isNightInProgress ? (
          /* LIVE NIGHT IN PROGRESS MODE */
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="col-span-full lg:col-span-2">
              <NightInProgressCard
                baby={baby}
                nightDate={effectiveDate}
                nightStart={nw.start}
                nightEnd={nw.end}
                prematureWeeks={settings.prematureWeeks}
                bedtimeHour={settings.bedtimeHour}
                wakeHour={settings.wakeHour}
                normalWakeMinutes={settings.normalWakeMinutes}
                refreshKey={refreshKey}
                onScoreLoaded={setLiveScore}
                onSelectDate={setDate}
              />
            </div>
            <div className="col-span-full flex flex-col gap-4 lg:col-span-1">
              <SleepFactorsCard
                baby={baby}
                nightDate={effectiveDate}
                night={liveScore}
                customOptions={settings.customSleepFactors}
                onUpdateCustomOptions={customSleepFactors => setSettings({ customSleepFactors })}
                onSaved={refetch}
              />
              <MilestonesCard baby={baby} prematureWeeks={settings.prematureWeeks} bedtimeHour={settings.bedtimeHour} wakeHour={settings.wakeHour} />
            </div>
            <SectionCarouselTabs tabs={tonightTabs} activeId={tonightTab} onChange={setTonightTab} />
          </div>
        ) : (
          /* HISTORY MODE */
          <div className="grid gap-4 lg:grid-cols-3">
            {scoreError && !loading && (
              <div className="col-span-full">
                <ErrorState title="Couldn't load this night from Nanit" message={scoreError} onRetry={refetch} />
              </div>
            )}
            <SleepScoreCard
              score={sleepScore}
              loading={loading}
              babyName={settings.babyName || baby?.name}
              wakeHour={settings.wakeHour}
              onOpenSettings={() => setSettingsOpen(true)}
            />
            <div className="col-span-full flex flex-col gap-4 lg:col-span-1">
              <SleepFactorsCard
                baby={baby}
                nightDate={effectiveDate}
                night={sleepScore}
                customOptions={settings.customSleepFactors}
                onUpdateCustomOptions={customSleepFactors => setSettings({ customSleepFactors })}
                onSaved={refetch}
                loading={loading}
              />
              <EventsCard messages={messages} loading={loading} />
              <MilestonesCard baby={baby} prematureWeeks={settings.prematureWeeks} bedtimeHour={settings.bedtimeHour} wakeHour={settings.wakeHour} />
            </div>
            <SectionCarouselTabs tabs={historyTabs} activeId={historyTab} onChange={setHistoryTab} />
          </div>
        )}
      </main>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onUpdate={setSettings}
        birthdate={baby?.birthdate}
        nanitName={baby?.name}
      />
    </div>
  );
}

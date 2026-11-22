import { useEffect, useMemo, useState } from 'react';
import { Loader2, Play, Video } from 'lucide-react';
import { Card } from '../common/Card';
import { formatDuration } from '../../utils/date';
import { errorMessage } from '../../utils/errors';
import * as api from '../../services/api';
import type { Baby, ScoredNight, WakeDetail, WakeResponse } from '../../types';

function formatTime(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

interface Props {
  sleepScore: ScoredNight | null;
  loading?: boolean;
  /** With these, tapping a wake lets the parent correct whether they went in. */
  baby?: Baby | null;
  onSaved?: () => void;
}

interface TimelineVideoEvent {
  uid: string;
  key: string;
  title: string;
  time: number;
  clip?: boolean;
  url?: string;
  media_urls?: {
    clip?: string;
    thumbnail?: string;
  };
  raw_videos?: {
    media_segments?: { video_url: string }[];
  };
}

interface Bar {
  id: string;
  kind: 'sleep' | 'awake';
  start: number;
  end: number;
  left: number;
  width: number;
  label: string;
  wake?: WakeDetail;
}

const CLIP_MATCH_SLACK_SEC = 120;

function getClipUrl(e: TimelineVideoEvent): string | null {
  return e.media_urls?.clip || e.url || e.raw_videos?.media_segments?.[0]?.video_url || null;
}

const WAKE_STYLE: Record<WakeResponse, { bar: string; dot: string; label: string }> = {
  self_settled: { bar: 'bg-teal-500', dot: 'bg-teal-500', label: 'Self-settled' },
  parent_visit: { bar: 'bg-amber-500', dot: 'bg-amber-500', label: 'Parent went in' },
  taken_out: { bar: 'bg-rose-600', dot: 'bg-rose-600', label: 'Taken out' },
  asleep: { bar: 'bg-indigo-400/85 dark:bg-indigo-500/80 ring-1 ring-inset ring-white/40', dot: 'bg-indigo-400 dark:bg-indigo-500/80', label: 'Baby asleep (corrected)' },
  unknown: { bar: 'bg-slate-400 dark:bg-slate-500', dot: 'bg-slate-400 dark:bg-slate-500', label: 'Awake (no visit data)' },
};

const EVENT_BADGE: Record<string, string> = {
  PUT_TO_SLEEP: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
  FELL_ASLEEP: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  WOKE_UP: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  VISIT: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  REMOVED: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  MOTION: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
  SOUND: 'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300',
  CRYING: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
};

export function SleepTimeline({ sleepScore, loading, baby, onSaved }: Props) {
  // Tap/click a bar to show its label, correction controls, and matching video clip(s)
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [videoEvents, setVideoEvents] = useState<TimelineVideoEvent[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [activeClipUid, setActiveClipUid] = useState<string | null>(null);
  const [playingClipUid, setPlayingClipUid] = useState<string | null>(null);

  useEffect(() => {
    if (!baby) return;
    let cancelled = false;
    api.getVideoEvents(baby.uid, 100)
      .then(data => {
        if (cancelled) return;
        const clips = ((data?.events ?? []) as TimelineVideoEvent[])
          .filter(e => typeof e.time === 'number' && (getClipUrl(e) || e.media_urls?.thumbnail))
          .sort((a, b) => a.time - b.time);
        setVideoEvents(clips);
      })
      .catch(() => {
        if (!cancelled) setVideoEvents([]);
      })
      .finally(() => {
        if (!cancelled) setEventsLoaded(true);
      });
    return () => { cancelled = true; };
  }, [baby]);

  const { bars, hours, checkIns, longestStretch } = useMemo(() => {
    const empty = {
      bars: [] as Bar[],
      hours: [] as { label: string; left: number }[],
      checkIns: [] as { time: number; left: number; label: string }[],
      longestStretch: null as { start: number; end: number; left: number; width: number; center: number; durationLabel: string; detailLabel: string } | null,
    };
    if (!sleepScore || !sleepScore.segments?.length) return empty;

    const start = sleepScore.night_start;
    const end = sleepScore.night_end;
    const total = end - start;
    if (total <= 0) return empty;
    const pos = (t: number) => ((t - start) / total) * 100;

    // Older responses have gaps but no wake labels; fall back to unlabeled wakes
    const wakes: WakeDetail[] = sleepScore.details.wakes
      ?? (sleepScore.gaps || []).map(g => ({ ...g, response: 'unknown' as const, source: 'nanit' as const, visit_times: [] }));

    const bars: Bar[] = [
      ...sleepScore.segments.map(seg => ({
        id: `s${seg.begin_ts}`,
        kind: 'sleep' as const,
        start: seg.begin_ts,
        end: seg.end_ts,
        left: pos(seg.begin_ts),
        width: ((seg.end_ts - seg.begin_ts) / total) * 100,
        label: `Asleep ${formatDuration((seg.end_ts - seg.begin_ts) / 60)} · ${formatTime(seg.begin_ts)}–${formatTime(seg.end_ts)}`,
      })),
      ...wakes.map(w => ({
        id: `w${w.start}`,
        kind: 'awake' as const,
        start: w.start,
        end: w.end,
        left: pos(w.start),
        width: ((w.end - w.start) / total) * 100,
        label: w.response === 'asleep'
          ? `Baby asleep (corrected) · ${formatDuration(w.duration_minutes)} · ${formatTime(w.start)}–${formatTime(w.end)}`
          : `Awake ${formatDuration(w.duration_minutes)} · ${formatTime(w.start)}–${formatTime(w.end)} · ${WAKE_STYLE[w.response].label}${w.source === 'parent' ? ' (you set this)' : ''}`,
        wake: w,
      })),
    ];

    const checkIns = (sleepScore.details.check_ins ?? []).map(c => ({
      time: c.time,
      left: pos(c.time),
      label: `Parent check-in at ${formatTime(c.time)} while asleep${c.wake_within_minutes !== undefined ? ` · woke ${c.wake_within_minutes} min later` : ''}`,
    }));

    // Longest stretch bracket (directly driven by backend scoreNight calculation)
    let longestStretch: { start: number; end: number; left: number; width: number; center: number; durationLabel: string; detailLabel: string } | null = null;
    const span = sleepScore.details.longest_stretch;
    if (span && span.end > span.start && span.duration_minutes > 0) {
      const clampedStart = Math.max(start, Math.min(end, span.start));
      const clampedEnd = Math.max(clampedStart, Math.min(end, span.end));
      const left = pos(clampedStart);
      const width = ((clampedEnd - clampedStart) / total) * 100;
      if (width > 0) {
        const durationLabel = formatDuration(span.duration_minutes);
        longestStretch = {
          start: span.start,
          end: span.end,
          left,
          width,
          center: left + width / 2,
          durationLabel,
          detailLabel: `Longest stretch · ${durationLabel} (${formatTime(span.start)}–${formatTime(span.end)}, excludes self-settled wakes)`,
        };
      }
    }

    // Hour markers; on narrow screens only every other one is shown
    const markers: { label: string; left: number }[] = [];
    let t = Math.ceil(start / 3600) * 3600;
    while (t < end) {
      const d = new Date(t * 1000);
      const h = d.getHours();
      const label = h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;
      markers.push({ label, left: pos(t) });
      t += 3600;
    }

    return { bars, hours: markers, checkIns, longestStretch };
  }, [sleepScore]);

  const selectedBar = bars.find(b => b.id === selected) ?? null;
  const selectedCheckIn = selected?.startsWith('c') ? checkIns[Number(selected.slice(1))] : null;
  const selectedStretch = selected === 'longest-stretch' ? longestStretch : null;

  const matchingClips = useMemo(() => {
    if (!videoEvents.length) return [];
    let rangeStart: number | null = null;
    let rangeEnd: number | null = null;
    if (selectedBar) {
      rangeStart = selectedBar.start - CLIP_MATCH_SLACK_SEC;
      rangeEnd = selectedBar.end + CLIP_MATCH_SLACK_SEC;
    } else if (selectedCheckIn) {
      rangeStart = selectedCheckIn.time - CLIP_MATCH_SLACK_SEC;
      rangeEnd = selectedCheckIn.time + CLIP_MATCH_SLACK_SEC;
    } else if (selectedStretch) {
      rangeStart = selectedStretch.start - CLIP_MATCH_SLACK_SEC;
      rangeEnd = selectedStretch.end + CLIP_MATCH_SLACK_SEC;
    }
    if (rangeStart === null || rangeEnd === null) return [];
    return videoEvents.filter(e => e.time >= rangeStart! && e.time <= rangeEnd!);
  }, [videoEvents, selectedBar, selectedCheckIn, selectedStretch]);

  if (loading) {
    return (
      <Card title="Sleep Timeline">
        <div className="h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700" />
      </Card>
    );
  }

  if (!sleepScore || bars.length === 0) {
    return (
      <Card title="Sleep Timeline">
        <p className="py-6 text-center text-sm text-slate-400">No sleep data</p>
      </Card>
    );
  }

  const wakes = sleepScore.details.wakes ?? [];
  const used = new Set(wakes.map(w => w.response));
  const canEdit = !!baby && !!onSaved && !!sleepScore.details.wakes;

  const selectItem = (id: string) => {
    setSelected(prev => (prev === id ? null : id));
    setActiveClipUid(null);
    setPlayingClipUid(null);
  };

  const relabel = async (wake: WakeDetail, response: Exclude<WakeResponse, 'unknown'> | null) => {
    if (!baby || !onSaved) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.setWakeOverride(baby.uid, sleepScore.night_id, wake.start, response);
      onSaved();
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const chip = (active: boolean) =>
    `rounded-md px-2 py-1 text-[11px] font-medium transition disabled:opacity-40 ${
      active
        ? 'bg-indigo-600 text-white'
        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
    }`;

  const activeClip = matchingClips.find(c => c.uid === activeClipUid) ?? matchingClips[0] ?? null;
  const activeClipUrl = activeClip ? getClipUrl(activeClip) : null;
  const hasSelection = !!(selectedBar || selectedCheckIn || selectedStretch);

  return (
    <Card title="Sleep Timeline" className="col-span-full">
      {/* Check-in markers sit above the bar */}
      <div className="relative h-3">
        {checkIns.map((c, i) => (
          <button
            key={i}
            type="button"
            aria-label={c.label}
            title={c.label}
            onClick={() => selectItem(`c${i}`)}
            className="absolute top-0 flex h-3 w-4 -translate-x-1/2 items-end justify-center"
            style={{ left: `${c.left}%` }}
          >
            <span className="block h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-amber-500" />
          </button>
        ))}
      </div>
      <div className="relative h-10 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-700">
        {bars.map(bar => (
          <button
            key={bar.id}
            type="button"
            aria-label={bar.label}
            title={bar.label}
            onClick={() => selectItem(bar.id)}
            className={`absolute top-0 h-full ${
              bar.kind === 'sleep' ? 'bg-indigo-500 dark:bg-indigo-600' : WAKE_STYLE[bar.wake!.response].bar
            } ${selected === bar.id ? 'ring-2 ring-inset ring-white/70' : ''}`}
            style={{ left: `${bar.left}%`, width: `${Math.max(bar.width, 0.6)}%` }}
          />
        ))}
      </div>
      {/* Longest stretch bracket directly beneath the timeline bar */}
      {longestStretch && (
        <div className="relative mt-1 h-7">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 h-2 rounded-b border-x-2 border-b-2 border-teal-500/80 transition-all duration-300 dark:border-teal-400/80"
            style={{ left: `${longestStretch.left}%`, width: `${Math.max(longestStretch.width, 1)}%` }}
          />
          <button
            type="button"
            aria-label={longestStretch.detailLabel}
            title={longestStretch.detailLabel}
            onClick={() => selectItem('longest-stretch')}
            className={`absolute top-2.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium transition-all duration-300 ${
              selected === 'longest-stretch'
                ? 'bg-teal-600 text-white dark:bg-teal-500'
                : 'bg-teal-50 text-teal-700 hover:bg-teal-100 dark:bg-teal-950/60 dark:text-teal-300 dark:hover:bg-teal-900/60'
            } ${longestStretch.center < 18 ? '' : longestStretch.center > 82 ? '' : '-translate-x-1/2'}`}
            style={
              longestStretch.center < 18
                ? { left: '0%' }
                : longestStretch.center > 82
                  ? { right: '0%' }
                  : { left: `${longestStretch.center}%` }
            }
          >
            Longest · {longestStretch.durationLabel}
          </button>
        </div>
      )}
      <div className="relative mt-1 h-4">
        {hours.map((m, i) => (
          <span
            key={i}
            className={`absolute -translate-x-1/2 text-[10px] text-slate-400 ${i % 2 === 1 ? 'hidden sm:inline' : ''}`}
            style={{ left: `${m.left}%` }}
          >
            {m.label}
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-indigo-500 dark:bg-indigo-600" />
          <span className="text-xs text-slate-500 dark:text-slate-400">Asleep</span>
        </div>
        {(['self_settled', 'parent_visit', 'taken_out', 'asleep', 'unknown'] as const).filter(r => used.has(r)).map(r => (
          <div key={r} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${WAKE_STYLE[r].dot}`} />
            <span className="text-xs text-slate-500 dark:text-slate-400">{WAKE_STYLE[r].label}</span>
          </div>
        ))}
        {checkIns.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="block h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-amber-500" />
            <span className="text-xs text-slate-500 dark:text-slate-400">Check-in while asleep</span>
          </div>
        )}
      </div>
      <div className="mt-2 space-y-2.5 rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-900/50">
        <p className="text-xs text-slate-600 dark:text-slate-300">
          {selectedBar
            ? selectedBar.label
            : selectedCheckIn
              ? selectedCheckIn.label
              : selectedStretch
                ? selectedStretch.detailLabel
                : <span className="text-slate-400">Tap a segment for times and video clips{canEdit && wakes.length > 0 ? ', or an awake block to correct it' : ''}</span>}
        </p>
        {canEdit && selectedBar?.wake && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] text-slate-500 dark:text-slate-400">Correct block:</span>
            <button disabled={saving} className={chip(selectedBar.wake.response === 'asleep')} onClick={() => relabel(selectedBar.wake!, 'asleep')}>
              Baby asleep
            </button>
            <button disabled={saving} className={chip(selectedBar.wake.response === 'self_settled')} onClick={() => relabel(selectedBar.wake!, 'self_settled')}>
              Self-settled
            </button>
            <button disabled={saving} className={chip(selectedBar.wake.response === 'parent_visit')} onClick={() => relabel(selectedBar.wake!, 'parent_visit')}>
              Parent went in
            </button>
            <button disabled={saving} className={chip(selectedBar.wake.response === 'taken_out')} onClick={() => relabel(selectedBar.wake!, 'taken_out')}>
              Took baby out
            </button>
            {selectedBar.wake.source === 'parent' && (
              <button disabled={saving} className="text-[11px] text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => relabel(selectedBar.wake!, null)}>
                Use camera&apos;s guess
              </button>
            )}
            {saving && <Loader2 size={12} className="animate-spin text-slate-400" />}
          </div>
        )}
        {saveError && <p className="text-[11px] text-rose-600">{saveError}</p>}

        {/* Matching video clip viewer for the tapped timeline section */}
        {hasSelection && baby && (
          <div className="border-t border-slate-200/80 pt-2.5 dark:border-slate-800">
            {!eventsLoaded ? (
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <Loader2 size={12} className="animate-spin" />
                Loading clips…
              </div>
            ) : activeClip ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Video size={12} className="text-slate-400" />
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${EVENT_BADGE[activeClip.key] || 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'}`}>
                      {activeClip.key.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">{formatTime(activeClip.time)}</span>
                    {activeClip.title && (
                      <span className="truncate text-[11px] text-slate-600 dark:text-slate-300">{activeClip.title}</span>
                    )}
                  </div>
                  {matchingClips.length > 1 && (
                    <span className="text-[10px] text-slate-400">
                      {matchingClips.length} clips in this section
                    </span>
                  )}
                </div>

                {activeClipUrl && playingClipUid === activeClip.uid ? (
                  <video
                    key={activeClip.uid}
                    src={activeClipUrl}
                    controls
                    autoPlay
                    playsInline
                    className="max-h-64 w-full rounded-lg bg-black"
                    onError={() => setPlayingClipUid(null)}
                  />
                ) : (
                  <button
                    type="button"
                    disabled={!activeClipUrl}
                    onClick={() => activeClipUrl && setPlayingClipUid(activeClip.uid)}
                    className="group relative block w-full overflow-hidden rounded-lg bg-black/90 text-left disabled:cursor-default"
                  >
                    {activeClip.media_urls?.thumbnail ? (
                      <img
                        src={activeClip.media_urls.thumbnail}
                        alt={activeClip.title || activeClip.key}
                        className="max-h-48 w-full object-contain opacity-90 transition group-hover:opacity-100"
                      />
                    ) : (
                      <div className="flex h-32 items-center justify-center">
                        <Video size={24} className="text-slate-500" />
                      </div>
                    )}
                    {activeClipUrl && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition group-hover:bg-black/35">
                        <span className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-900 shadow-sm">
                          <Play size={12} className="fill-current" />
                          Play clip
                        </span>
                      </span>
                    )}
                  </button>
                )}

                {matchingClips.length > 1 && (
                  <div data-no-tab-swipe className="flex gap-1.5 overflow-x-auto pb-0.5">
                    {matchingClips.map(clip => {
                      const isCurrent = clip.uid === activeClip.uid;
                      return (
                        <button
                          key={clip.uid}
                          type="button"
                          onClick={() => {
                            setActiveClipUid(clip.uid);
                            setPlayingClipUid(null);
                          }}
                          className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] transition ${
                            isCurrent
                              ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/50 dark:text-indigo-300'
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                          }`}
                        >
                          {clip.media_urls?.thumbnail && (
                            <img src={clip.media_urls.thumbnail} alt="" className="h-5 w-7 rounded object-cover" />
                          )}
                          <span className="font-medium">{clip.key.replace(/_/g, ' ')}</span>
                          <span className="text-slate-400">{formatTime(clip.time)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <Video size={12} />
                No video clip available for this section
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

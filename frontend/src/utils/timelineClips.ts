export interface TimelineVideoEvent {
  uid: string;
  key: string;
  title: string;
  time: number;
  begin_ts?: number;
  end_ts?: number;
  clip?: boolean;
  url?: string;
  media_urls?: {
    clip?: string;
    thumbnail?: string;
    animated_thumbnail?: string;
  };
  raw_videos?: {
    media_segments?: { video_url: string }[];
  };
}

export interface TimelineBarSelection {
  kind: 'sleep' | 'awake';
  start: number;
  end: number;
  /** True when this is the first sleep block of the night (bedtime). */
  isFirstSleep?: boolean;
  /** True when an awake block immediately follows this sleep block. */
  hasFollowingWake?: boolean;
}

export interface MatchedClipsResult {
  clips: TimelineVideoEvent[];
  isNearbyFallback: boolean;
}

const MAX_TRUSTED_CLIP_SPAN_SEC = 5 * 60;
const BEDTIME_ONSET_LOOKBACK_SEC = 25 * 60;
const RESETTLE_ONSET_LOOKBACK_SEC = 5 * 60;
const SLEEP_END_WAKE_EXCLUSION_SEC = 3 * 60;
const WAKE_START_SLACK_SEC = 3 * 60;
const WAKE_END_SLACK_SEC = 2 * 60;
const CHECKIN_SLACK_SEC = 3 * 60;
const NEARBY_WAKE_SLACK_SEC = 10 * 60;
const NEARBY_BEDTIME_SLACK_SEC = 35 * 60;

const ONSET_KEYS = new Set(['PUT_IN_BED', 'PUT_TO_SLEEP', 'FELL_ASLEEP']);
const WAKE_END_KEYS = new Set(['WOKE_UP', 'CRYING', 'REMOVED', 'REMOVED_ASLEEP']);

export function getClipUrl(e: TimelineVideoEvent): string | null {
  return e.media_urls?.clip || e.url || e.raw_videos?.media_segments?.[0]?.video_url || null;
}

export function getClipThumb(e: TimelineVideoEvent): string | null {
  return e.media_urls?.thumbnail || e.media_urls?.animated_thumbnail || null;
}

/**
 * Reliable [start, end] for a video clip.
 * Nanit sometimes sets `begin_ts` on summary/wake events to the start of the
 * whole sleep session (hours earlier), so ignore multi-minute spans and anchor
 * strictly on `e.time`.
 */
export function clipBounds(e: TimelineVideoEvent): { start: number; end: number } {
  if (
    typeof e.begin_ts === 'number' &&
    typeof e.end_ts === 'number' &&
    e.begin_ts > 0 &&
    e.end_ts >= e.begin_ts &&
    e.end_ts - e.begin_ts <= MAX_TRUSTED_CLIP_SPAN_SEC &&
    Math.abs(e.time - e.begin_ts) <= MAX_TRUSTED_CLIP_SPAN_SEC &&
    Math.abs(e.end_ts - e.time) <= MAX_TRUSTED_CLIP_SPAN_SEC
  ) {
    return { start: Math.min(e.begin_ts, e.time), end: Math.max(e.end_ts, e.time) };
  }
  return { start: e.time, end: e.time };
}

function distanceToRange(clipStart: number, clipEnd: number, rangeStart: number, rangeEnd: number): number {
  if (clipEnd < rangeStart) return rangeStart - clipEnd;
  if (clipStart > rangeEnd) return clipStart - rangeEnd;
  return 0;
}

export function formatClipOffset(clip: TimelineVideoEvent, rangeStart: number, rangeEnd: number): string | null {
  const { start, end } = clipBounds(clip);
  if (end < rangeStart) {
    const mins = Math.max(1, Math.round((rangeStart - end) / 60));
    return `${mins}m before`;
  }
  if (start > rangeEnd) {
    const mins = Math.max(1, Math.round((start - rangeEnd) / 60));
    return `${mins}m after`;
  }
  return null;
}

export function matchClipsForBar(
  events: TimelineVideoEvent[],
  bar: TimelineBarSelection,
): MatchedClipsResult {
  if (!events.length) return { clips: [], isNearbyFallback: false };

  if (bar.kind === 'sleep') {
    const lookback = bar.isFirstSleep ? BEDTIME_ONSET_LOOKBACK_SEC : RESETTLE_ONSET_LOOKBACK_SEC;
    const windowStart = bar.start - lookback;
    const windowEnd = bar.hasFollowingWake ? bar.end : bar.end + WAKE_END_SLACK_SEC;

    const direct = events
      .filter(e => {
        const { start, end } = clipBounds(e);
        if (end < windowStart || start > windowEnd) return false;

        // Before sleep actually started, only include onset/settling clips (not an earlier wake's WOKE_UP/REMOVED)
        if (e.time < bar.start - 60 && WAKE_END_KEYS.has(e.key)) return false;

        // When an awake block immediately follows this sleep block, wake-up / visit clips at the end
        // belong to that following awake block rather than the sleep block that just ended.
        if (bar.hasFollowingWake && e.time >= bar.end - SLEEP_END_WAKE_EXCLUSION_SEC) {
          if (WAKE_END_KEYS.has(e.key) || e.key === 'VISIT' || e.time >= bar.end - 60) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        // Put sleep-onset clips near the start of the sleep block first so bedtime / put-down leads
        const aOnset = ONSET_KEYS.has(a.key) && Math.abs(a.time - bar.start) <= lookback ? 0 : 1;
        const bOnset = ONSET_KEYS.has(b.key) && Math.abs(b.time - bar.start) <= lookback ? 0 : 1;
        if (aOnset !== bOnset) return aOnset - bOnset;
        return a.time - b.time;
      });

    if (direct.length > 0) {
      return { clips: direct, isNearbyFallback: false };
    }

    // Nearby fallback for an asleep block: only search around the START (putting baby down),
    // never grab a wake-up clip from the end of the sleep block.
    if (bar.isFirstSleep) {
      const nearby = events
        .filter(e => !WAKE_END_KEYS.has(e.key) && e.time >= bar.start - NEARBY_BEDTIME_SLACK_SEC && e.time <= bar.start + 5 * 60)
        .sort((a, b) => Math.abs(a.time - bar.start) - Math.abs(b.time - bar.start))
        .slice(0, 3);
      if (nearby.length > 0) return { clips: nearby, isNearbyFallback: true };
    }

    return { clips: [], isNearbyFallback: false };
  }

  // Awake block: focus on [start - 3m, end + 2m], excluding sleep-onset clips before the wake began
  const wakeWindowStart = bar.start - WAKE_START_SLACK_SEC;
  const wakeWindowEnd = bar.end + WAKE_END_SLACK_SEC;

  const direct = events
    .filter(e => {
      const { start, end } = clipBounds(e);
      if (end < wakeWindowStart || start > wakeWindowEnd) return false;
      if (e.time < bar.start && ONSET_KEYS.has(e.key)) return false;
      return true;
    })
    .sort((a, b) => a.time - b.time);

  if (direct.length > 0) {
    return { clips: direct, isNearbyFallback: false };
  }

  const nearby = events
    .map(e => {
      const { start, end } = clipBounds(e);
      return { clip: e, dist: distanceToRange(start, end, bar.start, bar.end) };
    })
    .filter(x => x.dist <= NEARBY_WAKE_SLACK_SEC)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5)
    .map(x => x.clip);

  return { clips: nearby, isNearbyFallback: nearby.length > 0 };
}

export function matchClipsForCheckIn(
  events: TimelineVideoEvent[],
  checkInTime: number,
): MatchedClipsResult {
  if (!events.length) return { clips: [], isNearbyFallback: false };
  const direct = events
    .filter(e => {
      const { start, end } = clipBounds(e);
      return distanceToRange(start, end, checkInTime, checkInTime) <= CHECKIN_SLACK_SEC;
    })
    .sort((a, b) => {
      const aVisit = a.key === 'VISIT' ? 0 : 1;
      const bVisit = b.key === 'VISIT' ? 0 : 1;
      if (aVisit !== bVisit) return aVisit - bVisit;
      return Math.abs(a.time - checkInTime) - Math.abs(b.time - checkInTime);
    });
  return { clips: direct, isNearbyFallback: false };
}

export function matchClipsForStretch(
  events: TimelineVideoEvent[],
  stretchStart: number,
  stretchEnd: number,
  isFirstSleep: boolean,
  hasFollowingWake: boolean,
): MatchedClipsResult {
  return matchClipsForBar(events, {
    kind: 'sleep',
    start: stretchStart,
    end: stretchEnd,
    isFirstSleep,
    hasFollowingWake,
  });
}

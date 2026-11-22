import type { NanitCalendarEntry } from '../types/nanit.js';
import type { SleepAnnotation, SleepScoreBreakdown } from '../types/app.js';
import { classifyWakes, findCheckIns, wakeCounts, type WakeDetail, type WindowActivity } from './night-activity.js';

// ===== AGE-ADJUSTED EXPECTATIONS =====
// All keyed by adjusted age in months

interface AgeExpectations {
  nightSleepHours: { min: number; ideal: number; max: number };
  expectedWakes: number;      // Normal number of night wakes
  maxNormalWakes: number;     // Above this is genuinely disruptive
  normalWakeDuration: number; // Minutes - a feeding wake is expected to last this long
  maxNormalWakeDuration: number; // Minutes - beyond this is excessive
  idealBedtimeRange: [number, number]; // Hour range (e.g. [18.5, 20.5])
}

const AGE_EXPECTATIONS: { maxMonths: number; expectations: AgeExpectations }[] = [
  {
    maxMonths: 1, // 0-1 month adjusted
    expectations: {
      nightSleepHours: { min: 7, ideal: 8.5, max: 10 },
      expectedWakes: 4,
      maxNormalWakes: 6,
      normalWakeDuration: 30,
      maxNormalWakeDuration: 60,
      idealBedtimeRange: [19, 23], // Very flexible for newborns
    },
  },
  {
    maxMonths: 2, // 1-2 months adjusted
    expectations: {
      nightSleepHours: { min: 8, ideal: 9.5, max: 11 },
      expectedWakes: 3,
      maxNormalWakes: 5,
      normalWakeDuration: 25,
      maxNormalWakeDuration: 50,
      idealBedtimeRange: [19, 22],
    },
  },
  {
    maxMonths: 3, // 2-3 months adjusted
    expectations: {
      nightSleepHours: { min: 8, ideal: 10, max: 12 },
      expectedWakes: 3,
      maxNormalWakes: 4,
      normalWakeDuration: 20,
      maxNormalWakeDuration: 45,
      idealBedtimeRange: [18.5, 21],
    },
  },
  {
    maxMonths: 4, // 3-4 months adjusted
    expectations: {
      nightSleepHours: { min: 9, ideal: 10.5, max: 12 },
      expectedWakes: 2,
      maxNormalWakes: 4,
      normalWakeDuration: 20,
      maxNormalWakeDuration: 40,
      idealBedtimeRange: [18.5, 20.5],
    },
  },
  {
    maxMonths: 6, // 4-6 months adjusted
    expectations: {
      nightSleepHours: { min: 9, ideal: 11, max: 12 },
      expectedWakes: 2,
      maxNormalWakes: 3,
      normalWakeDuration: 15,
      maxNormalWakeDuration: 30,
      idealBedtimeRange: [18, 20],
    },
  },
  {
    maxMonths: 9, // 6-9 months adjusted
    expectations: {
      nightSleepHours: { min: 9.5, ideal: 11, max: 12 },
      expectedWakes: 1,
      maxNormalWakes: 2,
      normalWakeDuration: 10,
      maxNormalWakeDuration: 20,
      idealBedtimeRange: [18, 20],
    },
  },
  {
    maxMonths: 12, // 9-12 months adjusted
    expectations: {
      nightSleepHours: { min: 10, ideal: 11, max: 12 },
      expectedWakes: 1,
      maxNormalWakes: 2,
      normalWakeDuration: 10,
      maxNormalWakeDuration: 15,
      idealBedtimeRange: [18, 19.5],
    },
  },
  {
    maxMonths: 24, // 12-24 months
    expectations: {
      nightSleepHours: { min: 10, ideal: 11.5, max: 12.5 },
      expectedWakes: 0,
      maxNormalWakes: 1,
      normalWakeDuration: 5,
      maxNormalWakeDuration: 15,
      idealBedtimeRange: [18, 19.5],
    },
  },
  {
    maxMonths: 999, // 24+ months
    expectations: {
      nightSleepHours: { min: 9.5, ideal: 11, max: 12 },
      expectedWakes: 0,
      maxNormalWakes: 1,
      normalWakeDuration: 5,
      maxNormalWakeDuration: 10,
      idealBedtimeRange: [18.5, 20],
    },
  },
];

function getExpectations(adjustedAgeMonths: number): AgeExpectations {
  for (const entry of AGE_EXPECTATIONS) {
    if (adjustedAgeMonths < entry.maxMonths) return entry.expectations;
  }
  return AGE_EXPECTATIONS[AGE_EXPECTATIONS.length - 1].expectations;
}

/**
 * Adjusted age in months, accounting for prematurity, as of `asOf`
 * (defaults to now). Pass the night's date so historical nights are scored
 * against the expectations that applied at the time.
 */
export function getAdjustedAgeMonths(birthdateStr: string, prematureWeeks: number, asOf: Date = new Date()): number {
  const birthdate = new Date(birthdateStr);
  const chronologicalMonths = (asOf.getUTCFullYear() - birthdate.getUTCFullYear()) * 12 +
    (asOf.getUTCMonth() - birthdate.getUTCMonth()) +
    (asOf.getUTCDate() - birthdate.getUTCDate()) / 30;
  return Math.max(0, chronologicalMonths - prematureWeeks / 4.33);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ===== NIGHT SUMMARY =====

export interface NightSummary {
  night_start: number;
  night_end: number;
  total_duration_minutes: number;
  sleep_segments: NanitCalendarEntry[];
  gap_count: number;
  gaps: { start: number; end: number; duration_minutes: number }[];
  longest_stretch_minutes: number;
}

/** Gap between two sleep segments (minutes) above which they belong to different nights. */
export const NIGHT_SPLIT_MINUTES = 120;

export function buildNightSummaries(sleepEntries: NanitCalendarEntry[]): NightSummary[] {
  if (sleepEntries.length === 0) return [];

  const sorted = [...sleepEntries].sort((a, b) => a.begin_ts - b.begin_ts);
  const nights: NightSummary[] = [];
  let currentNight: NanitCalendarEntry[] = [sorted[0]];
  let currentNightEnd = sorted[0].end_ts;

  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i];
    const gapMinutes = (curr.begin_ts - currentNightEnd) / 60;

    if (gapMinutes > NIGHT_SPLIT_MINUTES) {
      nights.push(summarizeNight(currentNight));
      currentNight = [curr];
      currentNightEnd = curr.end_ts;
    } else {
      currentNight.push(curr);
      currentNightEnd = Math.max(currentNightEnd, curr.end_ts);
    }
  }
  nights.push(summarizeNight(currentNight));

  return nights;
}

function summarizeNight(segments: NanitCalendarEntry[]): NightSummary {
  const sorted = [...segments].sort((a, b) => a.begin_ts - b.begin_ts);
  const nightStart = sorted[0].begin_ts;

  const gaps: { start: number; end: number; duration_minutes: number }[] = [];
  let maxEnd = sorted[0].end_ts;
  let mergedStart = sorted[0].begin_ts;
  let mergedEnd = sorted[0].end_ts;
  let totalSleepSeconds = 0;

  for (let i = 1; i < sorted.length; i++) {
    const seg = sorted[i];
    if (seg.begin_ts > maxEnd) {
      gaps.push({ start: maxEnd, end: seg.begin_ts, duration_minutes: (seg.begin_ts - maxEnd) / 60 });
      totalSleepSeconds += mergedEnd - mergedStart;
      mergedStart = seg.begin_ts;
      mergedEnd = seg.end_ts;
    } else {
      mergedEnd = Math.max(mergedEnd, seg.end_ts);
    }
    maxEnd = Math.max(maxEnd, seg.end_ts);
  }
  totalSleepSeconds += mergedEnd - mergedStart;

  const nightEnd = maxEnd;
  const totalDuration = totalSleepSeconds / 60;
  const longestStretch = Math.max(...sorted.map(s => (s.end_ts - s.begin_ts) / 60));

  return {
    night_start: nightStart,
    night_end: nightEnd,
    total_duration_minutes: totalDuration,
    sleep_segments: sorted,
    gap_count: gaps.length,
    gaps,
    longest_stretch_minutes: longestStretch,
  };
}

/** Of several nights found in one window, the "main" one is the one with the most sleep. */
export function pickMainNight(nights: NightSummary[]): NightSummary {
  return nights.reduce((best, n) => (n.total_duration_minutes > best.total_duration_minutes ? n : best), nights[0]);
}

// ===== MANUAL ADJUSTMENTS =====

/**
 * Re-slice a night to a parent-supplied window. This is the fix for Nanit
 * mis-detecting when the night starts or ends:
 *  - segments outside the window are dropped, straddling ones are trimmed
 *  - if the custom start is earlier than the first detected segment (Nanit
 *    missed the beginning of the night), the first segment is extended back
 *    to it; likewise the last segment is extended to a later custom end
 *  - duration, wakes, gaps, and longest stretch are all recomputed
 */
export function applyAnnotation(night: NightSummary, annotation?: SleepAnnotation | null): NightSummary {
  if (!annotation) return night;
  const hasStart = typeof annotation.custom_start_time === 'number';
  const hasEnd = typeof annotation.custom_end_time === 'number';
  if (!hasStart && !hasEnd) return night;

  const start = hasStart ? annotation.custom_start_time! : night.night_start;
  const end = hasEnd ? annotation.custom_end_time! : night.night_end;
  if (end <= start) return night;

  let segs = night.sleep_segments
    .filter(s => s.end_ts > start && s.begin_ts < end)
    .map(s => ({ ...s, begin_ts: Math.max(s.begin_ts, start), end_ts: Math.min(s.end_ts, end) }));

  if (segs.length === 0) {
    // Nothing detected inside the parent's window: trust the parent, one continuous stretch
    segs = [{ ...night.sleep_segments[0], begin_ts: start, end_ts: end }];
  } else {
    if (hasStart && segs[0].begin_ts > start) segs[0] = { ...segs[0], begin_ts: start };
    const last = segs.length - 1;
    if (hasEnd && segs[last].end_ts < end) segs[last] = { ...segs[last], end_ts: end };
  }

  segs = segs.map(s => ({ ...s, duration: s.end_ts - s.begin_ts }));
  return summarizeNight(segs);
}

// ===== SCORING =====

export interface ScoreOptions {
  birthdate: string;
  prematureWeeks?: number;
  annotation?: SleepAnnotation | null;
  /** Client getTimezoneOffset(): minutes behind UTC (240 for EDT). */
  tzOffset?: number;
  /** The parent's configured bedtime hour; widens the ideal bedtime range if outside the age table. */
  bedtimeHour?: number;
  /** Nanit state events (VISIT, REMOVED, ...) for the night, used to tell self-settled wakes from parent visits. */
  activity?: WindowActivity | null;
}

export interface LongestStretch {
  /** Start of the first sleep segment in the stretch (unix seconds). */
  start: number;
  /** End of the last sleep segment in the stretch (unix seconds). */
  end: number;
  /** Total asleep duration in minutes (excludes awake time during bridged self-settled wakes). */
  duration_minutes: number;
}

/**
 * Finds the longest stretch of sleep, excluding self-settled wakes:
 *  - Any wake classified as `self_settled` bridges adjacent sleep segments rather
 *    than breaking the stretch, with its awake duration excluded from the stretch total.
 *  - Any wake corrected by the parent to `asleep` (false-positive wake) merges
 *    adjacent sleep segments into continuous sleep, including that gap's duration.
 *  - Non-self-settled wakes (`parent_visit`, `taken_out`, `unknown`) break a stretch.
 */
export function findLongestStretch(night: NightSummary, wakes: WakeDetail[]): LongestStretch | null {
  if (night.sleep_segments.length === 0) return null;
  const selfSettledStarts = new Set(
    wakes.filter(w => w.response === 'self_settled').map(w => Math.round(w.start)),
  );
  const asleepStarts = new Set(
    wakes.filter(w => w.response === 'asleep').map(w => Math.round(w.start)),
  );
  const segs = [...night.sleep_segments].sort((a, b) => a.begin_ts - b.begin_ts);

  let bestSeconds = -1;
  let bestStart = segs[0].begin_ts;
  let bestEnd = segs[0].end_ts;

  let runSleepSeconds = 0;
  let runStart = segs[0].begin_ts;
  let mergedStart = segs[0].begin_ts;
  let mergedEnd = segs[0].end_ts;

  const finishRun = (endTs: number) => {
    const total = runSleepSeconds + (endTs - mergedStart);
    if (total > bestSeconds) {
      bestSeconds = total;
      bestStart = runStart;
      bestEnd = endTs;
    }
  };

  for (let i = 1; i < segs.length; i++) {
    const seg = segs[i];
    if (seg.begin_ts <= mergedEnd || asleepStarts.has(Math.round(mergedEnd))) {
      mergedEnd = Math.max(mergedEnd, seg.end_ts);
      continue;
    }

    if (selfSettledStarts.has(Math.round(mergedEnd))) {
      runSleepSeconds += mergedEnd - mergedStart;
    } else {
      finishRun(mergedEnd);
      runSleepSeconds = 0;
      runStart = seg.begin_ts;
    }
    mergedStart = seg.begin_ts;
    mergedEnd = seg.end_ts;
  }

  finishRun(mergedEnd);
  return {
    start: bestStart,
    end: bestEnd,
    duration_minutes: Math.max(0, bestSeconds) / 60,
  };
}

export function longestStretchMinutes(night: NightSummary, wakes: WakeDetail[]): number {
  return findLongestStretch(night, wakes)?.duration_minutes ?? 0;
}

/** Expected longest stretch (hours) by adjusted age. */
function expectedStretchHours(adjAge: number): number {
  return adjAge < 1 ? 2.5 : adjAge < 3 ? 3 : adjAge < 6 ? 4 : adjAge < 9 ? 6 : 8;
}

export function scoreNight(rawNight: NightSummary, opts: ScoreOptions): SleepScoreBreakdown {
  const { birthdate, prematureWeeks = 0, annotation, tzOffset = 0, bedtimeHour, activity } = opts;
  const night = applyAnnotation(rawNight, annotation);
  const wakes = classifyWakes(night.gaps, activity, annotation?.wake_overrides);
  const counts = wakeCounts(wakes);

  // Score against the age the baby was on that night, not today
  const adjAge = getAdjustedAgeMonths(birthdate, prematureWeeks, new Date(night.night_start * 1000));
  const expect = getExpectations(adjAge);

  // Gaps the parent corrected to "Baby asleep" are false wakes: count them as sleep, not wakes
  const falseWakeMinutes = wakes
    .filter(w => w.response === 'asleep')
    .reduce((sum, w) => sum + w.duration_minutes, 0);
  const realWakes = wakes.filter(w => w.response !== 'asleep');

  const actualSleepMinutes = night.total_duration_minutes + falseWakeMinutes;
  const targetMinutes = expect.nightSleepHours.ideal * 60;

  // === 1. DURATION SCORE (0-35) ===
  const durationRatio = actualSleepMinutes / targetMinutes;
  let durationScore: number;
  if (durationRatio >= 0.95) durationScore = 35;
  else if (durationRatio >= 0.85) durationScore = 30;
  else if (durationRatio >= 0.75) durationScore = 25;
  else if (durationRatio >= 0.65) durationScore = 20;
  else if (durationRatio >= 0.50) durationScore = 15;
  else durationScore = Math.round(durationRatio * 30);

  // === 2. CONTINUITY SCORE (0-35) ===
  // Age-adjusted: expected wakes don't count against the score.
  // Only wakes beyond the expected count AND wakes longer than normal penalize.
  // Wakes the baby settled from without a parent visit are a skill, not a
  // disruption: they never count toward "extra" wakes, and running long costs
  // half (the lost sleep already shows up in Duration).
  let continuityScore = 35;

  const totalWakes = realWakes.length;
  const disruptiveWakes = totalWakes - counts.self_settled;
  const excessWakeCount = Math.max(0, disruptiveWakes - expect.expectedWakes);

  // -5 per excess wake, capped at -20
  const excessWakePenalty = Math.min(excessWakeCount * 5, 20);
  continuityScore -= excessWakePenalty;

  // -1 per 5 minutes a wake runs past the normal duration, capped at -5 per wake
  let longWakePenalty = 0;
  for (const wake of realWakes) {
    const excessMinutes = Math.max(0, wake.duration_minutes - expect.normalWakeDuration);
    if (excessMinutes > 0) {
      const penalty = Math.min(Math.floor(excessMinutes / 5), 5);
      longWakePenalty += wake.response === 'self_settled' ? Math.floor(penalty / 2) : penalty;
    }
  }
  continuityScore = Math.max(0, continuityScore - longWakePenalty);

  // === 3. LONGEST STRETCH SCORE (0-15) ===
  const longestStretchSpan = findLongestStretch(night, wakes);
  const longestStretch = longestStretchSpan?.duration_minutes ?? 0;
  const longestHours = longestStretch / 60;
  const expectedStretch = expectedStretchHours(adjAge);
  const stretchRatio = longestHours / expectedStretch;
  let stretchScore: number;
  if (stretchRatio >= 1.0) stretchScore = 15;
  else if (stretchRatio >= 0.8) stretchScore = 12;
  else if (stretchRatio >= 0.6) stretchScore = 9;
  else if (stretchRatio >= 0.4) stretchScore = 6;
  else stretchScore = 3;

  // === 4. TIMING SCORE (0-15) ===
  // The age table gives an evidence-based range; a deliberately chosen family
  // bedtime outside it widens the range rather than being penalized.
  const bedtimeLocalMs = night.night_start * 1000 - tzOffset * 60 * 1000;
  const bedtimeDate = new Date(bedtimeLocalMs);
  const bedtimeLocalHour = bedtimeDate.getUTCHours() + bedtimeDate.getUTCMinutes() / 60;
  let [idealStart, idealEnd] = expect.idealBedtimeRange;
  if (typeof bedtimeHour === 'number') {
    idealStart = Math.min(idealStart, bedtimeHour - 0.5);
    idealEnd = Math.max(idealEnd, bedtimeHour + 1);
  }

  let timingScore: number;
  if (bedtimeLocalHour >= idealStart && bedtimeLocalHour <= idealEnd) {
    timingScore = 15;
  } else {
    const distance = bedtimeLocalHour < idealStart
      ? idealStart - bedtimeLocalHour
      : bedtimeLocalHour - idealEnd;
    timingScore = Math.max(0, 15 - Math.round(distance * 5));
  }

  const totalScore = durationScore + continuityScore + stretchScore + timingScore;
  const hasCustomStart = typeof annotation?.custom_start_time === 'number';
  const hasCustomEnd = typeof annotation?.custom_end_time === 'number';

  return {
    total_score: clamp(totalScore, 0, 100),
    duration_score: durationScore,
    continuity_score: continuityScore,
    onset_score: stretchScore,
    timing_score: timingScore,
    details: {
      total_sleep_minutes: Math.round(actualSleepMinutes),
      target_sleep_minutes: Math.round(targetMinutes),
      wake_count: totalWakes,
      longest_stretch_minutes: Math.round(longestStretch),
      ...(longestStretchSpan && {
        longest_stretch: {
          start: longestStretchSpan.start,
          end: longestStretchSpan.end,
          duration_minutes: Math.round(longestStretchSpan.duration_minutes),
        },
      }),
      bedtime: new Date(night.night_start * 1000).toISOString(),
      wake_time: new Date(night.night_end * 1000).toISOString(),
      ...(hasCustomStart && { custom_bedtime: new Date(annotation!.custom_start_time! * 1000).toISOString() }),
      ...(hasCustomEnd && { custom_wake_time: new Date(annotation!.custom_end_time! * 1000).toISOString() }),
      adjusted: hasCustomStart || hasCustomEnd,
      wakes,
      check_ins: findCheckIns(night, wakes, activity),
    },
    // Everything the score was judged against, so the UI can show its work
    expectations: {
      adjusted_age_months: Math.round(adjAge * 10) / 10,
      ideal_sleep_hours: expect.nightSleepHours.ideal,
      expected_wakes: expect.expectedWakes,
      normal_wake_minutes: expect.normalWakeDuration,
      expected_stretch_hours: expectedStretch,
      ideal_bedtime_range: [idealStart, idealEnd],
      excess_wake_penalty: excessWakePenalty,
      long_wake_penalty: longWakePenalty,
      self_settled_wakes: counts.self_settled,
      parent_visit_wakes: counts.parent_visit + counts.taken_out,
      unknown_wakes: counts.unknown,
    },
  };
}

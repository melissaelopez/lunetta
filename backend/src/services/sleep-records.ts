import { NanitAuthError } from './nanit-client.js';
import { scoreWindow, type RangeParams } from './night-history.js';
import { nightWindowFromDateStr, pastNightDates } from './night-windows.js';
import * as store from './store.js';
import type { CachedSleepRecords, NightRecordSummary } from './storage.js';

export interface SleepRecordMetric {
  value: number;
  date: string;
}

export interface AllTimeSleepRecords {
  highest_score: SleepRecordMetric | null;
  longest_stretch_minutes: SleepRecordMetric | null;
  most_sleep_minutes: SleepRecordMetric | null;
  nights_analyzed: number;
  earliest_date: string | null;
  latest_date: string | null;
  updated_at: number;
}

const MAX_SCAN_DAYS = 365;
/** Stop scanning backwards after this many consecutive empty nights once we have seen at least one night of data. */
const EMPTY_STREAK_AFTER_DATA = 21;
/** Stop scanning backwards if there has been no data at all for this many consecutive nights from yesterday. */
const EMPTY_STREAK_NO_DATA = 30;
const BATCH_SIZE = 8;
const CONCURRENCY = 4;

/** Shift a YYYY-MM-DD date string by `deltaDays` (UTC calendar arithmetic). */
export function shiftDateStr(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

function normalizeBirthdate(birthdate: string): string | null {
  const iso = birthdate.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

/** Pure computation of all-time highs from scored night summaries. Ties break toward the most recent date. */
export function computeAllTimeRecords(
  nights: NightRecordSummary[],
  updatedAt: number = Date.now(),
): AllTimeSleepRecords {
  if (nights.length === 0) {
    return {
      highest_score: null,
      longest_stretch_minutes: null,
      most_sleep_minutes: null,
      nights_analyzed: 0,
      earliest_date: null,
      latest_date: null,
      updated_at: updatedAt,
    };
  }

  let highestScore: SleepRecordMetric | null = null;
  let longestStretch: SleepRecordMetric | null = null;
  let mostSleep: SleepRecordMetric | null = null;
  let earliestDate = nights[0].date;
  let latestDate = nights[0].date;

  for (const n of nights) {
    if (n.date < earliestDate) earliestDate = n.date;
    if (n.date > latestDate) latestDate = n.date;

    if (
      !highestScore ||
      n.score > highestScore.value ||
      (n.score === highestScore.value && n.date > highestScore.date)
    ) {
      highestScore = { value: n.score, date: n.date };
    }

    if (
      n.longest_stretch_minutes > 0 &&
      (!longestStretch ||
        n.longest_stretch_minutes > longestStretch.value ||
        (n.longest_stretch_minutes === longestStretch.value && n.date > longestStretch.date))
    ) {
      longestStretch = { value: n.longest_stretch_minutes, date: n.date };
    }

    if (
      n.total_sleep_minutes > 0 &&
      (!mostSleep ||
        n.total_sleep_minutes > mostSleep.value ||
        (n.total_sleep_minutes === mostSleep.value && n.date > mostSleep.date))
    ) {
      mostSleep = { value: n.total_sleep_minutes, date: n.date };
    }
  }

  return {
    highest_score: highestScore,
    longest_stretch_minutes: longestStretch,
    most_sleep_minutes: mostSleep,
    nights_analyzed: nights.length,
    earliest_date: earliestDate,
    latest_date: latestDate,
    updated_at: updatedAt,
  };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type ScoreOutcome = { status: 'found'; summary: NightRecordSummary } | { status: 'empty' } | { status: 'error' };

async function scoreDate(
  params: Omit<RangeParams, 'days' | 'beforeDate'>,
  date: string,
): Promise<ScoreOutcome> {
  const window = nightWindowFromDateStr(date, params.bedtimeHour, params.wakeHour, params.tzOffset);
  try {
    const scored = await scoreWindow(params, window);
    if (!scored) return { status: 'empty' };
    return {
      status: 'found',
      summary: {
        date,
        score: scored.score.total_score,
        longest_stretch_minutes: scored.score.details.longest_stretch_minutes,
        total_sleep_minutes: scored.score.details.total_sleep_minutes,
      },
    };
  } catch (err: any) {
    if (err instanceof NanitAuthError || /401|Unauthorized/.test(String(err?.message))) throw err;
    console.log(`[sleep-records] ${date} failed: ${err?.message}`);
    return { status: 'error' };
  }
}

/**
 * Mark one night date as stale in the baby's cached all-time records so manual
 * annotations / wake overrides are reflected on the next Trends load without
 * rescanning the entire history.
 */
export async function markSleepRecordDateStale(babyUid: string, date: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const cached = await store.getSleepRecordsCache(babyUid).catch(() => null);
  if (!cached) return;
  const stale = new Set(cached.stale_dates ?? []);
  if (stale.has(date)) return;
  stale.add(date);
  await store.saveSleepRecordsCache({
    ...cached,
    stale_dates: Array.from(stale),
  }).catch(() => {});
}

/**
 * Compute all-time highest sleep score, longest stretch, and sleep duration.
 * Uses an incremental persisted summary cache so the first scan backfills back
 * to the start of the baby's Nanit history (up to 365 days / birthdate), and
 * subsequent visits only score new completed nights or recently edited nights.
 */
export async function getAllTimeSleepRecords(
  p: Omit<RangeParams, 'days' | 'beforeDate'>,
  opts: { force?: boolean } = {},
): Promise<AllTimeSleepRecords> {
  const babySettings = p.normalWakeMinutes === undefined
    ? await store.getBabySettings(p.babyUid).catch(() => null)
    : null;
  const normalWakeMinutes = p.normalWakeMinutes !== undefined
    ? p.normalWakeMinutes
    : (babySettings?.normal_wake_minutes ?? null);

  const params = { ...p, normalWakeMinutes };
  const yesterday = pastNightDates(1, p.tzOffset)[0];
  const minByWindow = shiftDateStr(yesterday, -(MAX_SCAN_DAYS - 1));
  const birth = normalizeBirthdate(p.birthdate);
  const earliestAllowed = birth && birth > minByWindow ? birth : minByWindow;

  if (earliestAllowed > yesterday) {
    return computeAllTimeRecords([], Date.now());
  }

  const settingsKey = `v2|${birth ?? p.birthdate}|${p.prematureWeeks}|${p.bedtimeHour}|${p.wakeHour}|${p.tzOffset}|${normalWakeMinutes ?? 'default'}`;
  const existing = opts.force ? null : await store.getSleepRecordsCache(p.babyUid).catch(() => null);
  const cacheValid = !!(existing && existing.settings_key === settingsKey);

  const nights: Record<string, NightRecordSummary> = cacheValid ? { ...existing!.nights } : {};
  const emptyDates = new Set<string>(cacheValid ? (existing!.empty_dates ?? []) : []);
  let scannedBackTo = cacheValid ? existing!.scanned_back_to : '';
  let latestScannedDate = cacheValid ? existing!.latest_scanned_date : '';
  let historyComplete = cacheValid ? existing!.history_complete : false;
  let dirty = !cacheValid;

  // 1. Re-score stale dates (edited annotations) + any new completed nights since last scan
  const datesToRefresh = new Set<string>();
  if (cacheValid) {
    for (const d of existing!.stale_dates ?? []) {
      if (d <= yesterday && d >= earliestAllowed) datesToRefresh.add(d);
    }
    if (latestScannedDate && latestScannedDate < yesterday) {
      let cursor = shiftDateStr(latestScannedDate, 1);
      let guard = 0;
      while (cursor <= yesterday && guard < MAX_SCAN_DAYS) {
        datesToRefresh.add(cursor);
        cursor = shiftDateStr(cursor, 1);
        guard++;
      }
    }
  }

  if (datesToRefresh.size > 0) {
    const refreshList = Array.from(datesToRefresh).sort();
    const outcomes = await mapWithConcurrency(refreshList, CONCURRENCY, d => scoreDate(params, d));
    refreshList.forEach((d, idx) => {
      const res = outcomes[idx];
      if (res.status === 'found') {
        nights[d] = res.summary;
        emptyDates.delete(d);
      } else if (res.status === 'empty') {
        delete nights[d];
        emptyDates.add(d);
      }
    });
    if (!latestScannedDate || yesterday > latestScannedDate) {
      latestScannedDate = yesterday;
    }
    dirty = true;
  }

  // 2. Scan backwards until we reach earliestAllowed or hit a long empty streak
  if (!historyComplete) {
    let cursor = scannedBackTo ? shiftDateStr(scannedBackTo, -1) : yesterday;
    if (!latestScannedDate) latestScannedDate = yesterday;

    let foundAny = Object.keys(nights).length > 0;
    let emptyStreak = 0;

    while (cursor >= earliestAllowed) {
      const batch: string[] = [];
      for (let i = 0; i < BATCH_SIZE && cursor >= earliestAllowed; i++) {
        batch.push(cursor);
        cursor = shiftDateStr(cursor, -1);
      }

      const outcomes = await mapWithConcurrency(batch, CONCURRENCY, d => scoreDate(params, d));
      dirty = true;

      let stoppedEarly = false;
      for (let i = 0; i < batch.length; i++) {
        const d = batch[i];
        const res = outcomes[i];
        scannedBackTo = d;

        if (res.status === 'found') {
          nights[d] = res.summary;
          emptyDates.delete(d);
          foundAny = true;
          emptyStreak = 0;
        } else if (res.status === 'empty') {
          delete nights[d];
          emptyDates.add(d);
          emptyStreak++;
          const limit = foundAny ? EMPTY_STREAK_AFTER_DATA : EMPTY_STREAK_NO_DATA;
          if (emptyStreak >= limit) {
            historyComplete = true;
            stoppedEarly = true;
            break;
          }
        }
      }

      if (stoppedEarly) break;
    }

    if (cursor < earliestAllowed) {
      historyComplete = true;
    }
  }

  const now = Date.now();
  if (dirty) {
    const snapshot: CachedSleepRecords = {
      baby_uid: p.babyUid,
      settings_key: settingsKey,
      nights,
      empty_dates: Array.from(emptyDates),
      stale_dates: [],
      scanned_back_to: scannedBackTo || yesterday,
      latest_scanned_date: latestScannedDate || yesterday,
      history_complete: historyComplete,
      updated_at: now,
    };
    await store.saveSleepRecordsCache(snapshot).catch(err => {
      console.log(`[sleep-records] cache write failed: ${err.message}`);
    });
  }

  return computeAllTimeRecords(Object.values(nights), dirty ? now : (existing?.updated_at ?? now));
}

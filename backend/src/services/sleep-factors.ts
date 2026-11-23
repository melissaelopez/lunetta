import { nightId } from './night-windows.js';
import { shiftDateStr } from './sleep-records.js';
import * as store from './store.js';
import type { SleepAnnotation } from '../types/app.js';

export interface ResolvedSleepFactors {
  sleep_factors: string[];
  inherited: boolean;
  inherited_from?: string;
  /** The up-to-date annotation (including any newly persisted carried-over factors). */
  annotation: SleepAnnotation | null;
}

export interface ResolveSleepFactorsOptions {
  maxLookbackDays?: number;
  /** When true (default), persist carried-over sleep factors to Firestore/SQLite on first load. */
  persist?: boolean;
  getAnnotationFn?: (babyUid: string, nightKey: string) => Promise<SleepAnnotation | null>;
  saveAnnotationFn?: (annotation: SleepAnnotation) => Promise<void>;
}

const DEFAULT_LOOKBACK_DAYS = 14;

/**
 * Resolve effective sleep factor chips for a night:
 * - If `ownAnnotation` already has an explicit `sleep_factors` array (including `[]`,
 *   when a parent intentionally clears all chips for a night), return it directly.
 * - Otherwise, look backwards up to `maxLookbackDays` nights and inherit the
 *   most recent prior night's `sleep_factors`.
 * - When `persist` is true (default) and non-empty factors are inherited, write them
 *   to Firestore/SQLite right away so every night keeps its own durable record even
 *   after 14+ days or if earlier nights are later edited.
 */
export async function resolveNightSleepFactors(
  babyUid: string,
  date: string,
  ownAnnotation?: SleepAnnotation | null,
  opts: ResolveSleepFactorsOptions = {},
): Promise<ResolvedSleepFactors> {
  const maxLookbackDays = opts.maxLookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const persist = opts.persist ?? true;
  const getAnnotationFn = opts.getAnnotationFn ?? store.getAnnotation;
  const saveAnnotationFn = opts.saveAnnotationFn ?? store.saveAnnotation;

  if (ownAnnotation && Array.isArray(ownAnnotation.sleep_factors)) {
    return {
      sleep_factors: ownAnnotation.sleep_factors,
      inherited: !!ownAnnotation.sleep_factors_inherited_from,
      inherited_from: ownAnnotation.sleep_factors_inherited_from,
      annotation: ownAnnotation,
    };
  }

  let cursor = date;
  for (let i = 0; i < maxLookbackDays; i++) {
    cursor = shiftDateStr(cursor, -1);
    const prev = await getAnnotationFn(babyUid, nightId(babyUid, cursor)).catch(() => null);
    if (prev && Array.isArray(prev.sleep_factors)) {
      if (prev.sleep_factors.length === 0) {
        return { sleep_factors: [], inherited: false, annotation: ownAnnotation ?? null };
      }

      let annotation: SleepAnnotation | null = ownAnnotation ?? null;
      if (persist) {
        const id = ownAnnotation?.session_id ?? nightId(babyUid, date);
        const materialized: SleepAnnotation = {
          ...(ownAnnotation ?? { baby_uid: babyUid, session_id: id }),
          sleep_factors: prev.sleep_factors,
          sleep_factors_inherited_from: cursor,
          updated_at: ownAnnotation?.updated_at ?? Date.now(),
        };
        await saveAnnotationFn(materialized).catch(err => {
          console.log(`[sleep-factors] persist carry-over failed for ${date}: ${err?.message}`);
        });
        annotation = materialized;
      }

      return {
        sleep_factors: prev.sleep_factors,
        inherited: true,
        inherited_from: cursor,
        annotation,
      };
    }
  }

  return { sleep_factors: [], inherited: false, annotation: ownAnnotation ?? null };
}

/**
 * Apply carry-over sleep factor chips across a chronological list of nights
 * (oldest -> newest), optionally seeded with prior factors from before the list.
 */
export function applySleepFactorCarryover<T extends { annotation: SleepAnnotation | null }>(
  nights: T[],
  seedFactors?: string[],
): string[][] {
  let lastExplicit: string[] = seedFactors ?? [];
  return nights.map(n => {
    if (n.annotation && Array.isArray(n.annotation.sleep_factors)) {
      lastExplicit = n.annotation.sleep_factors;
      return lastExplicit;
    }
    return lastExplicit;
  });
}

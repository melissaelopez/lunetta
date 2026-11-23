import { nightId } from './night-windows.js';
import { shiftDateStr } from './sleep-records.js';
import * as store from './store.js';
import type { SleepAnnotation } from '../types/app.js';

export interface ResolvedSleepFactors {
  sleep_factors: string[];
  inherited: boolean;
  inherited_from?: string;
}

const DEFAULT_LOOKBACK_DAYS = 14;

/**
 * Resolve effective sleep factor chips for a night:
 * - If `ownAnnotation` has an explicit `sleep_factors` array (including `[]`,
 *   when a parent intentionally clears all chips for a night), use it directly.
 * - Otherwise, look backwards up to `maxLookbackDays` nights and inherit the
 *   most recent prior night's explicit `sleep_factors`.
 */
export async function resolveNightSleepFactors(
  babyUid: string,
  date: string,
  ownAnnotation?: SleepAnnotation | null,
  maxLookbackDays = DEFAULT_LOOKBACK_DAYS,
  getAnnotationFn: (babyUid: string, nightKey: string) => Promise<SleepAnnotation | null> = store.getAnnotation,
): Promise<ResolvedSleepFactors> {
  if (ownAnnotation && Array.isArray(ownAnnotation.sleep_factors)) {
    return { sleep_factors: ownAnnotation.sleep_factors, inherited: false };
  }

  let cursor = date;
  for (let i = 0; i < maxLookbackDays; i++) {
    cursor = shiftDateStr(cursor, -1);
    const prev = await getAnnotationFn(babyUid, nightId(babyUid, cursor)).catch(() => null);
    if (prev && Array.isArray(prev.sleep_factors)) {
      if (prev.sleep_factors.length === 0) {
        return { sleep_factors: [], inherited: false };
      }
      return {
        sleep_factors: prev.sleep_factors,
        inherited: true,
        inherited_from: cursor,
      };
    }
  }

  return { sleep_factors: [], inherited: false };
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

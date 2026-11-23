import test from 'node:test';
import assert from 'node:assert/strict';
import { applySleepFactorCarryover, resolveNightSleepFactors } from '../src/services/sleep-factors.js';
import type { SleepAnnotation } from '../src/types/app.js';

function makeAnnotations(entries: Record<string, Partial<SleepAnnotation>>) {
  const map = new Map<string, SleepAnnotation>();
  for (const [date, partial] of Object.entries(entries)) {
    const key = `baby1:${date}`;
    map.set(key, {
      baby_uid: 'baby1',
      session_id: key,
      updated_at: 1,
      ...partial,
    });
  }
  return async (_babyUid: string, nightKey: string) => map.get(nightKey) ?? null;
}

test('resolveNightSleepFactors inherits previous night factors when current night has none set', async () => {
  const getAnnotation = makeAnnotations({
    '2026-11-21': { sleep_factors: ['Arms out — Halo Easy Transition Sleep Sack', 'White noise'] },
    '2026-11-22': { notes: 'Dream feed was bumpy' }, // note only, sleep_factors not explicitly set
  });

  const resolved = await resolveNightSleepFactors(
    'baby1',
    '2026-11-22',
    await getAnnotation('baby1', 'baby1:2026-11-22'),
    14,
    getAnnotation,
  );

  assert.deepEqual(resolved, {
    sleep_factors: ['Arms out — Halo Easy Transition Sleep Sack', 'White noise'],
    inherited: true,
    inherited_from: '2026-11-21',
  });
});

test('resolveNightSleepFactors respects an explicit empty array when parent cleared all chips', async () => {
  const getAnnotation = makeAnnotations({
    '2026-11-20': { sleep_factors: ['Pacifier'] },
    '2026-11-21': { sleep_factors: [] },
  });

  const clearedNight = await resolveNightSleepFactors(
    'baby1',
    '2026-11-21',
    await getAnnotation('baby1', 'baby1:2026-11-21'),
    14,
    getAnnotation,
  );
  assert.deepEqual(clearedNight, { sleep_factors: [], inherited: false });

  // The night after an explicitly cleared night should stay empty rather than skipping back to Nov 20
  const followingNight = await resolveNightSleepFactors('baby1', '2026-11-22', null, 14, getAnnotation);
  assert.deepEqual(followingNight, { sleep_factors: [], inherited: false });
});

test('applySleepFactorCarryover carries forward prior factors until explicitly overridden', () => {
  const mk = (sleep_factors?: string[]): { annotation: SleepAnnotation | null } => ({
    annotation: sleep_factors !== undefined
      ? { baby_uid: 'b', session_id: 's', sleep_factors, updated_at: 1 }
      : null,
  });

  const result = applySleepFactorCarryover(
    [
      mk(undefined),
      mk(['Arms out — Halo Swaddle Sleep Sack', 'White noise']),
      mk(undefined),
      mk(['Arms out — Halo Easy Transition Sleep Sack']),
      mk([]),
      mk(undefined),
    ],
    ['Arms in — swaddle'],
  );

  assert.deepEqual(result, [
    ['Arms in — swaddle'],
    ['Arms out — Halo Swaddle Sleep Sack', 'White noise'],
    ['Arms out — Halo Swaddle Sleep Sack', 'White noise'],
    ['Arms out — Halo Easy Transition Sleep Sack'],
    [],
    [],
  ]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { applySleepFactorCarryover, resolveNightSleepFactors } from '../src/services/sleep-factors.js';
import type { SleepAnnotation } from '../src/types/app.js';

function makeStore(entries: Record<string, Partial<SleepAnnotation>>) {
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
  const saved: SleepAnnotation[] = [];
  return {
    map,
    saved,
    getAnnotationFn: async (_babyUid: string, nightKey: string) => map.get(nightKey) ?? null,
    saveAnnotationFn: async (annotation: SleepAnnotation) => {
      saved.push(annotation);
      map.set(annotation.session_id, annotation);
    },
  };
}

test('resolveNightSleepFactors inherits previous night factors and persists them to storage on first load', async () => {
  const s = makeStore({
    '2026-11-21': { sleep_factors: ['Arms out — Halo Easy Transition Sleep Sack', 'White noise'] },
    '2026-11-22': { notes: 'Dream feed was bumpy' }, // note only, sleep_factors not explicitly set yet
  });

  const resolved = await resolveNightSleepFactors(
    'baby1',
    '2026-11-22',
    await s.getAnnotationFn('baby1', 'baby1:2026-11-22'),
    { getAnnotationFn: s.getAnnotationFn, saveAnnotationFn: s.saveAnnotationFn },
  );

  assert.deepEqual(resolved.sleep_factors, ['Arms out — Halo Easy Transition Sleep Sack', 'White noise']);
  assert.equal(resolved.inherited, true);
  assert.equal(resolved.inherited_from, '2026-11-21');
  assert.equal(s.saved.length, 1);
  assert.equal(s.saved[0].notes, 'Dream feed was bumpy');
  assert.deepEqual(s.saved[0].sleep_factors, ['Arms out — Halo Easy Transition Sleep Sack', 'White noise']);
  assert.equal(s.saved[0].sleep_factors_inherited_from, '2026-11-21');

  // Second load reads the persisted annotation directly without writing again
  const second = await resolveNightSleepFactors(
    'baby1',
    '2026-11-22',
    await s.getAnnotationFn('baby1', 'baby1:2026-11-22'),
    { getAnnotationFn: s.getAnnotationFn, saveAnnotationFn: s.saveAnnotationFn },
  );
  assert.equal(s.saved.length, 1);
  assert.deepEqual(second.sleep_factors, ['Arms out — Halo Easy Transition Sleep Sack', 'White noise']);
  assert.equal(second.inherited, true);
  assert.equal(second.inherited_from, '2026-11-21');
});

test('resolveNightSleepFactors respects an explicit empty array when parent cleared all chips', async () => {
  const s = makeStore({
    '2026-11-20': { sleep_factors: ['Pacifier'] },
    '2026-11-21': { sleep_factors: [] },
  });

  const clearedNight = await resolveNightSleepFactors(
    'baby1',
    '2026-11-21',
    await s.getAnnotationFn('baby1', 'baby1:2026-11-21'),
    { getAnnotationFn: s.getAnnotationFn, saveAnnotationFn: s.saveAnnotationFn },
  );
  assert.deepEqual(clearedNight.sleep_factors, []);
  assert.equal(clearedNight.inherited, false);

  // The night after an explicitly cleared night should stay empty rather than skipping back to Nov 20
  const followingNight = await resolveNightSleepFactors(
    'baby1',
    '2026-11-22',
    null,
    { getAnnotationFn: s.getAnnotationFn, saveAnnotationFn: s.saveAnnotationFn },
  );
  assert.deepEqual(followingNight.sleep_factors, []);
  assert.equal(followingNight.inherited, false);
  assert.equal(s.saved.length, 0);
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

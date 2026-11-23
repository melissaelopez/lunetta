import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteStore } from '../src/services/sqlite.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'lunetta-sqlite-test-'));
  const path = join(dir, 'lunetta.db');
  const storage = createSqliteStore(path);
  return { path, dir, storage, cleanup: () => { storage.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('settings, annotations, caches and feedback survive reopen', async () => {
  const f = fixture();
  try {
    assert.equal(await f.storage.getBabySettings('baby'), null);
    await f.storage.saveBabySettings({ baby_uid: 'baby', name: 'A', bedtime_hour: 19, custom_sleep_factors: ['Zipadee-Zip'], updated_at: 1 });
    await f.storage.saveBabySettings({ baby_uid: 'baby', name: 'B', updated_at: 2 });
    assert.deepEqual(await f.storage.getBabySettings('baby'), { baby_uid: 'baby', name: 'B', bedtime_hour: 19, custom_sleep_factors: ['Zipadee-Zip'], updated_at: 2 });
    const annotation = { baby_uid: 'baby', session_id: 'night', custom_start_time: 1, sleep_factors: ['Arms out — Halo Easy Transition Sleep Sack'], updated_at: 2 };
    await f.storage.saveAnnotation(annotation);
    await f.storage.cacheInsight('baby', 'night', { summary: 'test' });
    assert.equal(await f.storage.getCachedInsight('baby', 'missing'), null);
    await f.storage.cacheNights('baby', 1, 2, []);
    await f.storage.cacheActivity('baby', 1, 2, { covered: true, events: [{ key: 'VISIT', time: 1 }] });
    const feedbackId = await f.storage.addFeedback({ message: 'hello', email: null, page: '/', kind: 'feedback', user_agent: 'test', created_at: 3 });
    f.storage.close();
    const reopened = createSqliteStore(f.path);
    try {
      assert.deepEqual(await reopened.getAnnotation('baby', 'night'), annotation);
      assert.deepEqual(await reopened.getCachedInsight('baby', 'night'), { summary: 'test' });
      assert.deepEqual(await reopened.getCachedNights('baby', 1, 2), []);
      assert.deepEqual(await reopened.getCachedActivity('baby', 1, 2), { covered: true, events: [{ key: 'VISIT', time: 1 }] });
      assert.equal(await reopened.getCachedActivity('other', 1, 2), null);
      assert.equal(await reopened.getCachedActivity('baby', 1, 3), null);
      assert.equal((await reopened.getFeedback(1))[0].id, feedbackId);
      await reopened.deleteAnnotation('baby', 'night');
      assert.equal(await reopened.getAnnotation('baby', 'night'), null);
    } finally { reopened.close(); }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('AI budget is atomic, scoped by baby and UTC day, and failures do not increment', async () => {
  const f = fixture();
  try {
    const attempts = await Promise.all(Array.from({ length: 12 }, () => f.storage.reserveAiCall('2026-09-24', 'baby', 'insights', 3, 4)));
    assert.equal(attempts.filter(x => x === null).length, 3);
    assert.equal(await f.storage.reserveAiCall('2026-09-24', 'other', 'insights', 3, 4), null);
    assert.equal(await f.storage.reserveAiCall('2026-09-24', 'other', 'insights', 3, 4), 'global');
    assert.equal(await f.storage.reserveAiCall('2026-09-25', 'baby', 'insights', 3, 4), null);
  } finally { f.cleanup(); }
});

test('statistics accumulate and return newest first', async () => {
  const f = fixture();
  try {
    await f.storage.incrementStats('2026-09-23', { page_views: 1, unique_visitors: 1 });
    await f.storage.incrementStats('2026-09-24', { page_views: 1, logins: 1, active_babies: 1 }, 'baby');
    await f.storage.incrementStats('2026-09-24', { page_views: 1 });
    assert.deepEqual(await f.storage.getStats('2026-09-24'), [{ day: '2026-09-24', page_views: 2, unique_visitors: 0, logins: 1, active_babies: 1 }]);
  } finally { f.cleanup(); }
});

test('insight cache expires after 24 hours', async () => {
  const f = fixture();
  const originalNow = Date.now;
  try {
    Date.now = () => 1_000_000;
    await f.storage.cacheInsight('baby', 'night', { summary: 'old' });
    Date.now = () => 1_000_000 + 86_400_001;
    assert.equal(await f.storage.getCachedInsight('baby', 'night'), null);
  } finally { Date.now = originalNow; f.cleanup(); }
});

test('insights chat threads and sleep records cache survive reopen and stay scoped per baby', async () => {
  const f = fixture();
  try {
    await f.storage.saveInsightsChat({
      baby_uid: 'baby_1',
      night_date: '2026-11-20',
      messages: [
        { role: 'user', content: 'Why did the score drop?', created_at: 100 },
        { role: 'assistant', content: 'There were two parent visits.', created_at: 101, model: 'gemini-flash-latest' },
      ],
      updated_at: 101,
    });
    await f.storage.saveInsightsChat({
      baby_uid: 'baby_1',
      night_date: '2026-11-22',
      messages: [
        { role: 'user', content: 'How did Halo arms-out compare?', created_at: 200 },
        { role: 'assistant', content: 'Longest stretch improved by 45m.', created_at: 201, model: 'gemini-pro-latest' },
      ],
      updated_at: 201,
    });
    await f.storage.saveInsightsChat({
      baby_uid: 'babyX1',
      night_date: '2026-11-22',
      messages: [{ role: 'user', content: 'Other baby thread', created_at: 300 }],
      updated_at: 300,
    });

    const recordsSnapshot = {
      baby_uid: 'baby_1',
      settings_key: '2026-06-01|0|19|8|300|default',
      nights: {
        '2026-11-20': { date: '2026-11-20', score: 88, longest_stretch_minutes: 310, total_sleep_minutes: 620 },
      },
      empty_dates: ['2026-11-19'],
      stale_dates: [],
      scanned_back_to: '2026-11-19',
      latest_scanned_date: '2026-11-20',
      history_complete: true,
      updated_at: 400,
    };
    await f.storage.saveSleepRecordsCache(recordsSnapshot);
    f.storage.close();

    const reopened = createSqliteStore(f.path);
    try {
      const thread = await reopened.getInsightsChat('baby_1', '2026-11-22');
      assert.equal(thread?.messages.length, 2);
      assert.equal(thread?.messages[1].model, 'gemini-pro-latest');

      const list = await reopened.listInsightsChats('baby_1', 10);
      assert.equal(list.length, 2);
      // Newest updated_at first, and babyX1 must not match baby_1 wildcard
      assert.equal(list[0].night_date, '2026-11-22');
      assert.equal(list[0].preview, 'How did Halo arms-out compare?');
      assert.equal(list[1].night_date, '2026-11-20');

      await reopened.deleteInsightsChat('baby_1', '2026-11-20');
      assert.equal(await reopened.getInsightsChat('baby_1', '2026-11-20'), null);
      assert.equal((await reopened.listInsightsChats('baby_1', 10)).length, 1);

      assert.deepEqual(await reopened.getSleepRecordsCache('baby_1'), recordsSnapshot);
      assert.equal(await reopened.getSleepRecordsCache('babyX1'), null);
    } finally { reopened.close(); }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

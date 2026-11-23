import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAllTimeRecords, shiftDateStr } from '../src/services/sleep-records.js';

test('computeAllTimeRecords returns null metrics for empty history', () => {
  const res = computeAllTimeRecords([], 12345);
  assert.deepEqual(res, {
    highest_score: null,
    longest_stretch_minutes: null,
    most_sleep_minutes: null,
    nights_analyzed: 0,
    earliest_date: null,
    latest_date: null,
    updated_at: 12345,
  });
});

test('computeAllTimeRecords finds highest score, longest stretch, and most sleep across nights and breaks ties toward newest date', () => {
  const res = computeAllTimeRecords([
    { date: '2026-10-15', score: 94, longest_stretch_minutes: 340, total_sleep_minutes: 615 },
    { date: '2026-10-28', score: 86, longest_stretch_minutes: 425, total_sleep_minutes: 600 },
    { date: '2026-11-05', score: 94, longest_stretch_minutes: 380, total_sleep_minutes: 675 },
    { date: '2026-11-18', score: 91, longest_stretch_minutes: 425, total_sleep_minutes: 640 },
  ], 999);

  assert.deepEqual(res.highest_score, { value: 94, date: '2026-11-05' });
  assert.deepEqual(res.longest_stretch_minutes, { value: 425, date: '2026-11-18' });
  assert.deepEqual(res.most_sleep_minutes, { value: 675, date: '2026-11-05' });
  assert.equal(res.nights_analyzed, 4);
  assert.equal(res.earliest_date, '2026-10-15');
  assert.equal(res.latest_date, '2026-11-18');
  assert.equal(res.updated_at, 999);
});

test('shiftDateStr crosses month, year, and leap day boundaries accurately', () => {
  assert.equal(shiftDateStr('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDateStr('2024-03-01', -1), '2024-02-29');
  assert.equal(shiftDateStr('2026-11-23', 10), '2026-12-03');
});

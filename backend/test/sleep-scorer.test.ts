import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildNightSummaries, longestStretchMinutes, scoreNight } from '../src/services/sleep-scorer.js';
import { classifyWakes, type WindowActivity } from '../src/services/night-activity.js';
import type { NanitCalendarEntry } from '../src/types/nanit.js';
import type { SleepAnnotation } from '../src/types/app.js';

interface FixtureFile {
  baby: {
    uid: string;
    birthdate: string;
    premature_weeks: number;
    tz_offset: number;
    bedtime_hour: number;
  };
  scenarios: Record<string, {
    description: string;
    birthdate?: string;
    calendar: NanitCalendarEntry[];
    activity: WindowActivity;
    annotation?: SleepAnnotation;
    expected?: Record<string, number>;
    expected_without_override?: Record<string, number>;
    expected_with_override?: Record<string, number>;
    expected_raw?: Record<string, number>;
    expected_annotated?: Record<string, number>;
    expected_default?: Record<string, number>;
    expected_custom_45?: Record<string, number>;
    expected_custom_60?: Record<string, number>;
  }>;
}

const fixturePath = resolve(import.meta.dirname, '../../tests/fixtures/sleep_scoring_longest_stretch.json');
const fixture: FixtureFile = JSON.parse(readFileSync(fixturePath, 'utf8'));

function baseScoreOpts(activity: WindowActivity, annotation?: SleepAnnotation | null) {
  return {
    birthdate: fixture.baby.birthdate,
    prematureWeeks: fixture.baby.premature_weeks,
    tzOffset: fixture.baby.tz_offset,
    bedtimeHour: fixture.baby.bedtime_hour,
    activity,
    annotation,
  };
}

test('brief self-settled wake bridges segments and excludes awake time from stretch', () => {
  const s = fixture.scenarios.brief_self_settled_wake;
  const [night] = buildNightSummaries(s.calendar);
  const wakes = classifyWakes(night.gaps, s.activity);
  const scored = scoreNight(night, baseScoreOpts(s.activity));

  assert.equal(longestStretchMinutes(night, wakes), s.expected!.longest_stretch_minutes);
  assert.equal(scored.details.total_sleep_minutes, s.expected!.total_sleep_minutes);
  assert.equal(scored.details.longest_stretch_minutes, s.expected!.longest_stretch_minutes);
  assert.equal(scored.details.wake_count, s.expected!.wake_count);
  assert.equal(scored.expectations.self_settled_wakes, s.expected!.self_settled_wakes);
});

test('self-settled wakes longer than 5 minutes do not break longest stretch and update Stretch score', () => {
  const s = fixture.scenarios.long_self_settled_wake_over_5_min;
  const [night] = buildNightSummaries(s.calendar);
  const scored = scoreNight(night, baseScoreOpts(s.activity));

  assert.equal(scored.details.total_sleep_minutes, s.expected!.total_sleep_minutes);
  assert.equal(scored.details.longest_stretch_minutes, s.expected!.longest_stretch_minutes);
  assert.deepEqual(scored.details.longest_stretch, {
    start: s.calendar[0].begin_ts,
    end: s.calendar[1].end_ts,
    duration_minutes: s.expected!.longest_stretch_minutes,
  });
  assert.equal(scored.onset_score, s.expected!.onset_score);
  assert.equal(scored.details.wake_count, s.expected!.wake_count);
  assert.equal(scored.expectations.self_settled_wakes, s.expected!.self_settled_wakes);
  assert.equal(scored.expectations.parent_visit_wakes, s.expected!.parent_visit_wakes);
  assert.ok(scored.details.longest_stretch_minutes <= scored.details.total_sleep_minutes);
});

test('all-self-settled night excludes wake durations so longest stretch never exceeds total sleep', () => {
  const s = fixture.scenarios.all_self_settled_night;
  const [night] = buildNightSummaries(s.calendar);
  const scored = scoreNight(night, baseScoreOpts(s.activity));

  assert.equal(scored.details.total_sleep_minutes, s.expected!.total_sleep_minutes);
  assert.equal(scored.details.longest_stretch_minutes, s.expected!.longest_stretch_minutes);
  assert.equal(scored.details.longest_stretch_minutes, scored.details.total_sleep_minutes);
  assert.equal(scored.expectations.self_settled_wakes, s.expected!.self_settled_wakes);
  assert.equal(scored.expectations.parent_visit_wakes, s.expected!.parent_visit_wakes);
});

test('mixed night bridges self-settled wakes on each side of a taken_out wake and picks the longer stretch', () => {
  const s = fixture.scenarios.mixed_self_settled_and_taken_out;
  const [night] = buildNightSummaries(s.calendar);
  const scored = scoreNight(night, baseScoreOpts(s.activity));

  assert.equal(scored.details.total_sleep_minutes, s.expected!.total_sleep_minutes);
  assert.equal(scored.details.longest_stretch_minutes, s.expected!.longest_stretch_minutes);
  assert.equal(scored.details.wake_count, s.expected!.wake_count);
  assert.equal(scored.expectations.self_settled_wakes, s.expected!.self_settled_wakes);
  assert.equal(scored.expectations.parent_visit_wakes, s.expected!.parent_visit_wakes);
});

test('unknown wakes from uncovered activity break the longest stretch', () => {
  const s = fixture.scenarios.uncovered_activity_breaks_stretch;
  const [night] = buildNightSummaries(s.calendar);
  const scored = scoreNight(night, baseScoreOpts(s.activity));

  assert.equal(scored.details.total_sleep_minutes, s.expected!.total_sleep_minutes);
  assert.equal(scored.details.longest_stretch_minutes, s.expected!.longest_stretch_minutes);
  assert.equal(scored.expectations.unknown_wakes, s.expected!.unknown_wakes);
});

test('parent wake overrides govern whether a wake bridges or breaks the longest stretch', () => {
  const s = fixture.scenarios.parent_wake_overrides;
  const [night] = buildNightSummaries(s.calendar);

  const withoutOverride = scoreNight(night, baseScoreOpts(s.activity));
  assert.equal(withoutOverride.details.longest_stretch_minutes, s.expected_without_override!.longest_stretch_minutes);
  assert.deepEqual(withoutOverride.details.longest_stretch, {
    start: s.calendar[1].begin_ts,
    end: s.calendar[2].end_ts,
    duration_minutes: s.expected_without_override!.longest_stretch_minutes,
  });

  const withOverride = scoreNight(night, baseScoreOpts(s.activity, s.annotation));
  assert.equal(withOverride.details.longest_stretch_minutes, s.expected_with_override!.longest_stretch_minutes);
  assert.deepEqual(withOverride.details.longest_stretch, {
    start: s.calendar[0].begin_ts,
    end: s.calendar[1].end_ts,
    duration_minutes: s.expected_with_override!.longest_stretch_minutes,
  });
});

test('overlapping segments and manual window annotations do not double-count or break stretches', () => {
  const s = fixture.scenarios.overlapping_and_annotated_segments;
  const [night] = buildNightSummaries(s.calendar);

  const rawScored = scoreNight(night, baseScoreOpts(s.activity));
  assert.equal(rawScored.details.total_sleep_minutes, s.expected_raw!.total_sleep_minutes);
  assert.equal(rawScored.details.longest_stretch_minutes, s.expected_raw!.longest_stretch_minutes);
  assert.equal(rawScored.details.wake_count, s.expected_raw!.wake_count);

  const annotatedScored = scoreNight(night, baseScoreOpts(s.activity, s.annotation));
  assert.equal(annotatedScored.details.total_sleep_minutes, s.expected_annotated!.total_sleep_minutes);
  assert.equal(annotatedScored.details.longest_stretch_minutes, s.expected_annotated!.longest_stretch_minutes);
  assert.deepEqual(annotatedScored.details.longest_stretch, {
    start: s.annotation!.custom_start_time,
    end: s.annotation!.custom_end_time,
    duration_minutes: s.expected_annotated!.longest_stretch_minutes,
  });
  assert.equal(annotatedScored.details.wake_count, s.expected_annotated!.wake_count);
  assert.equal(annotatedScored.details.adjusted, true);
});

test('correcting an awake block to Baby asleep adds its time to sleep and longest stretch and removes it from wake count', () => {
  const s = fixture.scenarios.false_wake_corrected_to_asleep;
  const [night] = buildNightSummaries(s.calendar);

  const withoutOverride = scoreNight(night, baseScoreOpts(s.activity));
  assert.equal(withoutOverride.details.total_sleep_minutes, s.expected_without_override!.total_sleep_minutes);
  assert.equal(withoutOverride.details.longest_stretch_minutes, s.expected_without_override!.longest_stretch_minutes);
  assert.equal(withoutOverride.details.wake_count, s.expected_without_override!.wake_count);
  assert.deepEqual(withoutOverride.details.longest_stretch, {
    start: s.calendar[1].begin_ts,
    end: s.calendar[2].end_ts,
    duration_minutes: s.expected_without_override!.longest_stretch_minutes,
  });

  const withAsleep = scoreNight(night, baseScoreOpts(s.activity, s.annotation));
  assert.equal(withAsleep.details.total_sleep_minutes, s.expected_with_override!.total_sleep_minutes);
  assert.equal(withAsleep.details.longest_stretch_minutes, s.expected_with_override!.longest_stretch_minutes);
  assert.equal(withAsleep.details.wake_count, s.expected_with_override!.wake_count);
  assert.equal(withAsleep.expectations.self_settled_wakes, s.expected_with_override!.self_settled_wakes);
  assert.equal(withAsleep.expectations.parent_visit_wakes, s.expected_with_override!.parent_visit_wakes);
  assert.deepEqual(withAsleep.details.longest_stretch, {
    start: s.calendar[0].begin_ts,
    end: s.calendar[2].end_ts,
    duration_minutes: s.expected_with_override!.longest_stretch_minutes,
  });
  // Corrected wake remains present in details.wakes so the parent can inspect or revert it on the timeline
  assert.equal(withAsleep.details.wakes.find(w => w.start === 1757989800)?.response, 'asleep');
});

test('custom normalWakeMinutes overrides age default long-wake penalty for newborn feeds', () => {
  const s = fixture.scenarios.custom_normal_wake_minutes_newborn;
  const [night] = buildNightSummaries(s.calendar);
  const base = {
    ...baseScoreOpts(s.activity),
    birthdate: s.birthdate!,
  };

  const withDefault = scoreNight(night, base);
  assert.equal(withDefault.expectations.normal_wake_minutes, s.expected_default!.normal_wake_minutes);
  assert.equal(withDefault.expectations.normal_wake_minutes_custom, false);
  assert.equal(withDefault.expectations.long_wake_penalty, s.expected_default!.long_wake_penalty);
  assert.equal(withDefault.continuity_score, s.expected_default!.continuity_score);

  const withCustom45 = scoreNight(night, { ...base, normalWakeMinutes: 45 });
  assert.equal(withCustom45.expectations.normal_wake_minutes, s.expected_custom_45!.normal_wake_minutes);
  assert.equal(withCustom45.expectations.normal_wake_minutes_custom, true);
  assert.equal(withCustom45.expectations.long_wake_penalty, s.expected_custom_45!.long_wake_penalty);
  assert.equal(withCustom45.continuity_score, s.expected_custom_45!.continuity_score);

  const withCustom60 = scoreNight(night, { ...base, normalWakeMinutes: 60 });
  assert.equal(withCustom60.expectations.normal_wake_minutes, s.expected_custom_60!.normal_wake_minutes);
  assert.equal(withCustom60.expectations.normal_wake_minutes_custom, true);
  assert.equal(withCustom60.expectations.long_wake_penalty, s.expected_custom_60!.long_wake_penalty);
  assert.equal(withCustom60.continuity_score, s.expected_custom_60!.continuity_score);
});

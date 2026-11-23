import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clipBounds,
  matchClipsForBar,
  matchClipsForCheckIn,
  type TimelineVideoEvent,
} from '../../frontend/src/utils/timelineClips.ts';

const H = 3600;
const M = 60;
// Anchor at 7:00 PM
const T_7PM = 1_760_000_000;

function ev(uid: string, key: string, time: number, extra: Partial<TimelineVideoEvent> = {}): TimelineVideoEvent {
  return {
    uid,
    key,
    title: key,
    time,
    clip: true,
    media_urls: { clip: `https://example.com/${uid}.mp4`, thumbnail: `https://example.com/${uid}.jpg` },
    ...extra,
  };
}

test('asleep block picks bedtime put-down clip from start and excludes wake-up clip from following awake block', () => {
  const events: TimelineVideoEvent[] = [
    // Put in bed 12 minutes before Nanit marked baby asleep at 7:00 PM
    ev('bedtime', 'PUT_IN_BED', T_7PM - 12 * M),
    // Wake-up clip right at midnight when the awake block begins
    ev('midnight_wake', 'WOKE_UP', T_7PM + 5 * H),
    // Morning wake-up clip at 8:00 AM with a bogus session-wide begin_ts spanning back to 7:00 PM
    ev('morning_wake', 'WOKE_UP', T_7PM + 13 * H, { begin_ts: T_7PM, end_ts: T_7PM + 13 * H }),
  ];

  // First asleep block: 7:00 PM -> 12:00 AM, followed by an awake block
  const sleepRes = matchClipsForBar(events, {
    kind: 'sleep',
    start: T_7PM,
    end: T_7PM + 5 * H,
    isFirstSleep: true,
    hasFollowingWake: true,
  });
  assert.deepEqual(sleepRes.clips.map(c => c.uid), ['bedtime']);
  assert.equal(sleepRes.isNearbyFallback, false);

  // Awake block that follows: 12:00 AM -> 12:20 AM
  const wakeRes = matchClipsForBar(events, {
    kind: 'awake',
    start: T_7PM + 5 * H,
    end: T_7PM + 5 * H + 20 * M,
  });
  assert.deepEqual(wakeRes.clips.map(c => c.uid), ['midnight_wake']);
  assert.equal(wakeRes.isNearbyFallback, false);
});

test('asleep block does not steal wake-up clip even when no bedtime clip exists', () => {
  const events: TimelineVideoEvent[] = [
    ev('midnight_wake', 'WOKE_UP', T_7PM + 5 * H - 60),
    ev('midnight_visit', 'VISIT', T_7PM + 5 * H + 30),
  ];

  const sleepRes = matchClipsForBar(events, {
    kind: 'sleep',
    start: T_7PM,
    end: T_7PM + 5 * H,
    isFirstSleep: true,
    hasFollowingWake: true,
  });
  assert.deepEqual(sleepRes.clips, []);
});

test('clipBounds ignores multi-hour session spans on begin_ts/end_ts and anchors on event time', () => {
  const morningEvent = ev('morning', 'WOKE_UP', T_7PM + 13 * H, {
    begin_ts: T_7PM,
    end_ts: T_7PM + 13 * H,
  });
  assert.deepEqual(clipBounds(morningEvent), {
    start: T_7PM + 13 * H,
    end: T_7PM + 13 * H,
  });

  const shortClip = ev('motion', 'MOTION', T_7PM + 2 * H, {
    begin_ts: T_7PM + 2 * H - 15,
    end_ts: T_7PM + 2 * H + 30,
  });
  assert.deepEqual(clipBounds(shortClip), {
    start: T_7PM + 2 * H - 15,
    end: T_7PM + 2 * H + 30,
  });
});

test('matchClipsForCheckIn prioritizes VISIT clips near the check-in time', () => {
  const events: TimelineVideoEvent[] = [
    ev('sound', 'SOUND', T_7PM + 3 * H - 60),
    ev('visit', 'VISIT', T_7PM + 3 * H + 10),
  ];
  const res = matchClipsForCheckIn(events, T_7PM + 3 * H);
  assert.deepEqual(res.clips.map(c => c.uid), ['visit', 'sound']);
});

import { Router } from 'express';
import * as nanit from '../services/nanit-client.js';
import { applyAnnotation, getAdjustedAgeMonths, pickMainNight, scoreNight } from '../services/sleep-scorer.js';
import { getNightsForWindow, loadScoredNights, scoreWindow, toHistoryPoint } from '../services/night-history.js';
import { getWindowActivity, type WakeResponse } from '../services/night-activity.js';
import { localDateStr, localNow, nightId, nightWindowFromDateStr, parseHourParam, parseOptionalHourParam } from '../services/night-windows.js';
import { requireToken } from '../middleware/auth.js';
import { handleRouteError } from '../middleware/errorHandler.js';
import * as store from '../services/store.js';
import { consumeAiBudget } from '../services/ai-budget.js';
import { getBabyProfile, profilePromptBlock } from '../services/baby-context.js';
import { getAllTimeSleepRecords, markSleepRecordDateStale } from '../services/sleep-records.js';
import { applySleepFactorCarryover, resolveNightSleepFactors } from '../services/sleep-factors.js';
import type { SleepAnnotation } from '../types/app.js';
import type { ScheduleRecommendation } from '../services/schedule-optimizer.js';

const router = Router();

/** Query params shared by every multi-night route. */
function rangeParams(req: any, defaultDays: number, maxDays = 60) {
  return {
    token: req.nanitToken as string,
    babyUid: String(req.params.babyUid),
    birthdate: String(req.query.birthdate || ''),
    prematureWeeks: parseInt(String(req.query.premature_weeks)) || 0,
    days: Math.min(parseInt(String(req.query.days)) || defaultDays, maxDays),
    bedtimeHour: parseHourParam(req.query.bedtime_hour, 19),
    wakeHour: parseHourParam(req.query.wake_hour, 8),
    tzOffset: parseInt(String(req.query.tz_offset)) || 0,
  };
}

router.get('/:babyUid/sleep', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const babyUid = String(req.params.babyUid);
    const start = parseInt(String(req.query.start));
    const end = parseInt(String(req.query.end));
    if (!start || !end) {
      res.status(400).json({ error: 'bad_request', message: 'start and end query params required (unix timestamps)' });
      return;
    }
    const nights = await getNightsForWindow(token, babyUid, start, end);
    res.json({ nights });
  } catch (err: any) {
    handleRouteError(res, err, 'fetch_failed');
  }
});

/**
 * Score every night found in a window. The longest one is the "main" night and
 * gets the stable id `${babyUid}:${YYYY-MM-DD}` used for annotations; any
 * other (nap-like) nights in the window get an `:altN` suffix.
 */
router.get('/:babyUid/sleep/score', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const babyUid = String(req.params.babyUid);
    const start = parseInt(String(req.query.start));
    const end = parseInt(String(req.query.end));
    const birthdate = String(req.query.birthdate || '');
    const prematureWeeks = parseInt(String(req.query.premature_weeks)) || 0;
    const tzOffset = parseInt(String(req.query.tz_offset)) || 0;
    const bedtimeHour = parseOptionalHourParam(req.query.bedtime_hour);
    const rawNormalWake = req.query.normal_wake_minutes;
    let queryNormalWake: number | null | undefined = undefined;
    if (rawNormalWake === 'default') {
      queryNormalWake = null;
    } else if (rawNormalWake !== undefined && rawNormalWake !== '') {
      const parsed = parseInt(String(rawNormalWake), 10);
      if (Number.isFinite(parsed) && parsed > 0) queryNormalWake = Math.min(90, Math.max(5, parsed));
    }
    if (!start || !end || !birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'start, end, and birthdate query params required' });
      return;
    }
    const [nights, activity, babySettings] = await Promise.all([
      getNightsForWindow(token, babyUid, start, end),
      getWindowActivity(token, babyUid, start, end),
      queryNormalWake === undefined ? store.getBabySettings(babyUid).catch(() => null) : Promise.resolve(null),
    ]);
    const normalWakeMinutes = queryNormalWake !== undefined ? queryNormalWake : (babySettings?.normal_wake_minutes ?? null);
    if (nights.length === 0) {
      res.json({ scores: [] });
      return;
    }
    const date = localDateStr(start, tzOffset);
    const main = pickMainNight(nights);
    let altIndex = 0;
    const scores = await Promise.all(nights.map(async raw => {
      const isMain = raw === main;
      const id = isMain ? nightId(babyUid, date) : `${nightId(babyUid, date)}:alt${++altIndex}`;
      const annotation = await store.getAnnotation(babyUid, id).catch(() => null);
      const adjusted = applyAnnotation(raw, annotation);
      const resolvedFactors = isMain
        ? await resolveNightSleepFactors(babyUid, date, annotation)
        : null;
      const effectiveAnnotation = resolvedFactors?.annotation ?? annotation;
      return {
        night_id: id,
        is_main: isMain,
        ...scoreNight(raw, { birthdate, prematureWeeks, annotation: effectiveAnnotation, tzOffset, bedtimeHour, normalWakeMinutes, activity }),
        night_start: adjusted.night_start,
        night_end: adjusted.night_end,
        raw_night_start: raw.night_start,
        raw_night_end: raw.night_end,
        segment_count: adjusted.sleep_segments.length,
        segments: adjusted.sleep_segments,
        gaps: adjusted.gaps,
        annotation: effectiveAnnotation,
        ...(resolvedFactors?.inherited && resolvedFactors.sleep_factors.length > 0 && {
          inherited_sleep_factors: resolvedFactors.sleep_factors,
          inherited_sleep_factors_from: resolvedFactors.inherited_from,
        }),
      };
    }));
    res.json({ scores });
  } catch (err: any) {
    handleRouteError(res, err, 'score_failed');
  }
});

// Effective sleep factors + note for a night (supports Tonight before first sleep segment)
router.get('/:babyUid/sleep/factors', requireToken, async (req, res) => {
  try {
    const babyUid = String(req.params.babyUid);
    const date = String(req.query.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'bad_request', message: 'date query param required (YYYY-MM-DD)' });
      return;
    }
    const id = nightId(babyUid, date);
    const annotation = await store.getAnnotation(babyUid, id).catch(() => null);
    const resolved = await resolveNightSleepFactors(babyUid, date, annotation);
    res.json({
      night_id: id,
      sleep_factors: resolved.sleep_factors,
      inherited: resolved.inherited,
      inherited_from: resolved.inherited_from ?? null,
      notes: annotation?.notes ?? '',
    });
  } catch (err: any) {
    handleRouteError(res, err, 'factors_failed');
  }
});

// Multi-night trend
router.get('/:babyUid/sleep/trend', requireToken, async (req, res) => {
  try {
    const p = rangeParams(req, 7);
    if (!p.birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'birthdate query param required' });
      return;
    }
    const nights = await loadScoredNights(p);
    const byDate = new Map(nights.map(n => [n.date, toHistoryPoint(n)]));
    // Keep a row for every requested date so the chart shows gaps
    const { pastNightDates } = await import('../services/night-windows.js');
    const trend = pastNightDates(p.days, p.tzOffset).map(date =>
      byDate.get(date) ?? {
        date,
        score: null,
        total_sleep_minutes: null,
        longest_stretch_minutes: null,
        self_settled_wakes: null,
        parent_visit_wakes: null,
        unknown_wakes: null,
      },
    );
    res.json({ trend });
  } catch (err: any) {
    handleRouteError(res, err, 'trend_failed');
  }
});

// All-time highest sleep score, longest stretch, and sleep duration
router.get('/:babyUid/sleep/records', requireToken, async (req, res) => {
  try {
    const p = rangeParams(req, 0);
    const force = req.query.force === 'true';
    if (!p.birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'birthdate query param required' });
      return;
    }
    const records = await getAllTimeSleepRecords(p, { force });
    res.json({ records });
  } catch (err: any) {
    handleRouteError(res, err, 'records_failed');
  }
});

/**
 * Whole days of sleep (nights + naps), like Nanit's Activity Tracker, with
 * daytime nap stats. `days` counts back from today and includes today.
 */
router.get('/:babyUid/sleep/days', requireToken, async (req, res) => {
  try {
    const p = rangeParams(req, 14, 31);
    const { loadDays, summarizeDays, napExpectations } = await import('../services/daytime.js');
    const { pastNightDates } = await import('../services/night-windows.js');
    const dates = [...pastNightDates(p.days - 1, p.tzOffset), localDateStr(Date.now() / 1000, p.tzOffset)];
    const adjAge = p.birthdate ? getAdjustedAgeMonths(p.birthdate, p.prematureWeeks) : null;
    const expectations = adjAge !== null ? napExpectations(adjAge) : null;
    const result = await loadDays(p, dates, expectations);
    res.json({
      ...result,
      summary: summarizeDays(result.days),
      expectations: expectations && { adjusted_age_months: Math.round(adjAge! * 10) / 10, ...expectations },
    });
  } catch (err: any) {
    handleRouteError(res, err, 'days_failed');
  }
});

// Milestones — detects achievements across recent nights
router.get('/:babyUid/sleep/milestones', requireToken, async (req, res) => {
  try {
    const p = rangeParams(req, 14);
    if (!p.birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'birthdate query param required' });
      return;
    }
    const { detectMilestones, toHistoryNights } = await import('../services/milestones.js');
    const history = (await loadScoredNights(p)).map(toHistoryPoint);
    const milestones = detectMilestones(toHistoryNights(history), p.tzOffset);
    res.json({ milestones, nights_analyzed: history.length });
  } catch (err: any) {
    handleRouteError(res, err, 'milestones_failed');
  }
});

// Compare two specific nights with the configured AI provider
router.get('/:babyUid/sleep/compare', requireToken, async (req, res) => {
  try {
    const p = rangeParams(req, 0);
    const dateA = String(req.query.date_a || '');
    const dateB = String(req.query.date_b || '');

    if (!dateA || !dateB || !p.birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'date_a, date_b, and birthdate required' });
      return;
    }
    if (dateA === dateB) {
      res.status(400).json({ error: 'bad_request', message: 'date_a and date_b must be different' });
      return;
    }

    const { compareNights } = await import('../services/night-comparison.js');

    const wa = nightWindowFromDateStr(dateA, p.bedtimeHour, p.wakeHour, p.tzOffset);
    const wb = nightWindowFromDateStr(dateB, p.bedtimeHour, p.wakeHour, p.tzOffset);

    const [nightA, nightB, eventsData, profile] = await Promise.all([
      scoreWindow(p, wa),
      scoreWindow(p, wb),
      nanit.getEvents(p.token, p.babyUid, 80).catch(() => ({ events: [] })),
      getBabyProfile(p.babyUid),
    ]);

    if (!nightA || !nightB) {
      res.status(404).json({ error: 'no_data', message: 'One or both nights have no sleep data' });
      return;
    }

    // Pick a few thumbnails from each night (up to 3 each to fit 6 total)
    async function downloadThumb(url: string): Promise<{ mimeType: string; data: string } | null> {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) return null;
        const buf = await r.arrayBuffer();
        if (buf.byteLength > 5 * 1024 * 1024) return null;
        return { mimeType: r.headers.get('content-type') || 'image/png', data: Buffer.from(buf).toString('base64') };
      } catch { return null; }
    }

    async function thumbsForWindow(start: number, end: number) {
      const rawEvents = (eventsData.events || []) as any[];
      const windowEvents = rawEvents
        .filter(e => e.time >= start && e.time <= end && e.media_urls?.thumbnail)
        .sort((a, b) => a.time - b.time);
      const picks = windowEvents.length <= 3 ? windowEvents : [0, Math.floor(windowEvents.length / 2), windowEvents.length - 1].map(i => windowEvents[i]);
      const downloads = await Promise.all(picks.map(e => downloadThumb(e.media_urls.thumbnail)));
      const valid: any[] = [];
      picks.forEach((e, i) => {
        if (downloads[i]) valid.push({ ...downloads[i], event_type: e.key, time: e.time });
      });
      return valid;
    }

    const [thumbsA, thumbsB, factorsA, factorsB] = await Promise.all([
      thumbsForWindow(wa.start, wa.end),
      thumbsForWindow(wb.start, wb.end),
      resolveNightSleepFactors(p.babyUid, dateA, nightA.annotation),
      resolveNightSleepFactors(p.babyUid, dateB, nightB.annotation),
    ]);

    const adjAge = getAdjustedAgeMonths(p.birthdate, p.prematureWeeks, new Date(nightB.night.night_start * 1000));
    await consumeAiBudget(p.babyUid, 'compare');
    const comparison = await compareNights(
      { date: dateA, score: nightA.score, night: nightA.night, sleepFactors: factorsA.sleep_factors, notes: nightA.annotation?.notes, thumbnailDataUrls: thumbsA },
      { date: dateB, score: nightB.score, night: nightB.night, sleepFactors: factorsB.sleep_factors, notes: nightB.annotation?.notes, thumbnailDataUrls: thumbsB },
      adjAge,
      p.tzOffset,
      profilePromptBlock(profile),
    );

    res.json({
      comparison,
      night_a: { date: dateA, score: nightA.score },
      night_b: { date: dateB, score: nightB.score },
      images_used: { a: thumbsA.length, b: thumbsB.length },
    });
  } catch (err: any) {
    console.error('[compare] Error:', err.message);
    handleRouteError(res, err, 'compare_failed');
  }
});

// Regression alerts — detects concerning patterns
router.get('/:babyUid/sleep/alerts', requireToken, async (req, res) => {
  try {
    const p = rangeParams(req, 10);
    if (!p.birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'birthdate query param required' });
      return;
    }
    const { detectRegressions } = await import('../services/regression-detector.js');
    const history = (await loadScoredNights(p)).map(toHistoryPoint);
    const alerts = detectRegressions(history, p.tzOffset);
    res.json({ alerts, nights_analyzed: history.length });
  } catch (err: any) {
    handleRouteError(res, err, 'alerts_failed');
  }
});

// Schedule Optimizer — the configured AI provider recommends bedtime/wake windows
router.get('/:babyUid/sleep/schedule-optimizer', requireToken, async (req, res) => {
  try {
    const p = rangeParams(req, 21, 30);
    const force = req.query.force === 'true';
    if (!p.birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'birthdate query param required' });
      return;
    }

    // Firestore cache — valid for 24h unless force
    const today = localNow(p.tzOffset).toISOString().split('T')[0];
    const cacheKey = `schedule:v3:${today}:${p.days}:${p.bedtimeHour}:${p.wakeHour}`;
    if (!force) {
      const cached = await store.getCachedInsight<ScheduleRecommendation>(p.babyUid, cacheKey).catch(() => null);
      if (cached) {
        res.json({ recommendation: cached, cached: true });
        return;
      }
    }

    const { recommendSchedule } = await import('../services/schedule-optimizer.js');
    const scored = await loadScoredNights(p);
    const oldestSeed = scored.length > 0 && !Array.isArray(scored[0].annotation?.sleep_factors)
      ? (await resolveNightSleepFactors(p.babyUid, scored[0].date, scored[0].annotation, { persist: false })).sleep_factors
      : [];
    const effectiveFactors = applySleepFactorCarryover(scored, oldestSeed);
    const history = scored.map((n, i) => ({
      ...toHistoryPoint(n),
      sleep_factors: effectiveFactors[i],
      notes: n.annotation?.notes,
    }));
    const adjAge = getAdjustedAgeMonths(p.birthdate, p.prematureWeeks);
    await consumeAiBudget(p.babyUid, 'schedule');
    const recommendation = await recommendSchedule(history, adjAge, p.bedtimeHour, p.wakeHour, p.tzOffset);

    await store.cacheInsight(p.babyUid, cacheKey, recommendation).catch(() => {});

    res.json({ recommendation, nights_analyzed: history.length, cached: false });
  } catch (err: any) {
    console.error('[optimizer] Error:', err.message);
    handleRouteError(res, err, 'optimizer_failed');
  }
});

const WAKE_RESPONSES: WakeResponse[] = ['self_settled', 'parent_visit', 'taken_out', 'asleep'];

/**
 * Save (or clear) a manual night adjustment. Body fields, all optional:
 *   custom_start_time / custom_end_time: unix seconds, or null to clear
 *   notes: string
 *   wake_override: { start, response } to relabel one wake (response null = back to Nanit's guess)
 * Fields left out keep their saved value. An annotation with nothing left in it is deleted.
 */
router.put('/:babyUid/sleep/:nightId', requireToken, async (req, res) => {
  try {
    const babyUid = String(req.params.babyUid);
    const id = String(req.params.nightId);
    const body = req.body ?? {};
    const existing = await store.getAnnotation(babyUid, id).catch(() => null);

    const timeField = (key: 'custom_start_time' | 'custom_end_time') => {
      if (!(key in body)) return existing?.[key];
      return typeof body[key] === 'number' ? Math.floor(body[key]) : undefined;
    };
    const start = timeField('custom_start_time');
    const end = timeField('custom_end_time');
    if (start !== undefined && end !== undefined && end <= start) {
      res.status(400).json({ error: 'bad_request', message: 'custom_end_time must be after custom_start_time' });
      return;
    }
    const notes = 'notes' in body
      ? (typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 1000) : undefined)
      : existing?.notes;

    const overrides: Record<string, WakeResponse> = { ...(existing?.wake_overrides ?? {}) };
    if (body.wake_override) {
      const wakeStart = Math.round(Number(body.wake_override.start));
      const response = body.wake_override.response;
      if (!wakeStart || (response !== null && !WAKE_RESPONSES.includes(response))) {
        res.status(400).json({ error: 'bad_request', message: 'wake_override needs a start and a valid response' });
        return;
      }
      if (response === null) delete overrides[String(wakeStart)];
      else overrides[String(wakeStart)] = response;
    }
    const hasOverrides = Object.keys(overrides).length > 0;

    let sleepFactors: string[] | undefined = existing?.sleep_factors;
    let sleepFactorsInheritedFrom: string | undefined = existing?.sleep_factors_inherited_from;
    if ('sleep_factors' in body) {
      sleepFactorsInheritedFrom = undefined;
      if (Array.isArray(body.sleep_factors)) {
        sleepFactors = Array.from(new Set<string>(
          (body.sleep_factors as unknown[])
            .filter((v): v is string => typeof v === 'string')
            .map(v => v.trim().slice(0, 80))
            .filter(Boolean),
        )).slice(0, 20);
      } else {
        sleepFactors = undefined;
      }
    }
    // Keep explicit empty arrays ([]) so clearing all chips on a night doesn't re-inherit the prior night's chips
    const hasSleepFactors = sleepFactors !== undefined;

    const dateMatch = id.match(/(\d{4}-\d{2}-\d{2})$/);

    if (start === undefined && end === undefined && !notes && !hasOverrides && !hasSleepFactors) {
      await store.deleteAnnotation(babyUid, id);
      if (dateMatch) await markSleepRecordDateStale(babyUid, dateMatch[1]);
      res.json({ success: true, annotation: null });
      return;
    }

    const annotation: SleepAnnotation = {
      session_id: id,
      baby_uid: babyUid,
      ...(start !== undefined && { custom_start_time: start }),
      ...(end !== undefined && { custom_end_time: end }),
      ...(notes && { notes }),
      ...(hasOverrides && { wake_overrides: overrides }),
      ...(hasSleepFactors && { sleep_factors: sleepFactors }),
      ...(sleepFactorsInheritedFrom && { sleep_factors_inherited_from: sleepFactorsInheritedFrom }),
      updated_at: Date.now(),
    };
    await store.saveAnnotation(annotation);
    if (dateMatch) await markSleepRecordDateStale(babyUid, dateMatch[1]);
    res.json({ success: true, annotation });
  } catch (err: any) {
    handleRouteError(res, err, 'update_failed');
  }
});

export default router;

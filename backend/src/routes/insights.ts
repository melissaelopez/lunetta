import { Router } from 'express';
import * as nanit from '../services/nanit-client.js';
import { getAdjustedAgeMonths } from '../services/sleep-scorer.js';
import { chatAboutNight, generateNightInsights, type NightInsights } from '../services/ai-insights.js';
import { loadScoredNights, scoreWindow } from '../services/night-history.js';
import { localDateStr, localHour } from '../services/night-windows.js';
import { requireToken } from '../middleware/auth.js';
import { handleRouteError } from '../middleware/errorHandler.js';
import * as store from '../services/store.js';
import { consumeAiBudget } from '../services/ai-budget.js';
import { getBabyProfile, profilePromptBlock } from '../services/baby-context.js';
import { dayPromptBlock, loadDays, napExpectations } from '../services/daytime.js';
import { isGeminiConfigured, resolveGeminiChatModel } from '../services/gemini-adapter.js';

const INSIGHTS_HISTORY_DAYS = 14;

const router = Router();

/**
 * Is the baby still in the middle of this night?
 * The window end (wake hour + buffer) being in the future is necessary but not
 * sufficient: a finished night viewed at 9am would otherwise read as "so far".
 * We also require that the last detected sleep ended recently — generously
 * before the configured wake hour (a mid-night feed can run long), tightly after it.
 */
function nightIsInProgress(windowEnd: number, lastSleepEnd: number, wakeHour: number, tzOffset: number): boolean {
  const nowSec = Date.now() / 1000;
  if (windowEnd <= nowSec) return false;
  const minutesSinceLastSleep = (nowSec - lastSleepEnd) / 60;
  const beforeWakeHour = localHour(nowSec, tzOffset) < wakeHour;
  return beforeWakeHour ? minutesSinceLastSleep < 120 : minutesSinceLastSleep < 30;
}

router.get('/:babyUid/sleep/insights', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const babyUid = String(req.params.babyUid);
    const start = parseInt(String(req.query.start));
    const end = parseInt(String(req.query.end));
    const birthdate = String(req.query.birthdate || '');
    const prematureWeeks = parseInt(String(req.query.premature_weeks)) || 0;
    const bedtimeHour = parseInt(String(req.query.bedtime_hour)) || 19;
    const wakeHour = parseInt(String(req.query.wake_hour)) || 8;
    const tzOffset = parseInt(String(req.query.tz_offset)) || 0;
    const force = req.query.force === 'true';

    if (!start || !end || !birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'start, end, and birthdate required' });
      return;
    }

    const currentDate = localDateStr(start, tzOffset);
    const rangeBase = { token, babyUid, birthdate, prematureWeeks, bedtimeHour, wakeHour, tzOffset };

    const current = await scoreWindow(rangeBase, { date: currentDate, start, end });
    if (!current) {
      res.json({ insights: { summary: 'No sleep data found for this night.', keyFactors: { positive: [], negative: [] }, comparison: '', patterns: [], tip: '' } });
      return;
    }

    const isInProgress = nightIsInProgress(end, current.night.night_end, wakeHour, tzOffset);
    const profile = await getBabyProfile(babyUid);
    const adjAge = getAdjustedAgeMonths(birthdate, prematureWeeks, new Date(current.night.night_start * 1000));

    // Optional per-request Gemini API key from client header. Never log, cache, or persist it.
    const userGeminiKey = req.header('x-gemini-api-key')?.trim() || undefined;

    // Check storage cache — skip for in-progress nights and forced regenerations.
    // The key includes the annotation timestamp so manual adjustments & sleep factors invalidate it.
    const nightKey = `${start}:v8:${current.annotation?.updated_at ?? 0}:p${profile.updated_at}`;
    if (!force && !isInProgress) {
      const cached = await store.getCachedInsight(babyUid, nightKey).catch(() => null);
      if (cached) {
        res.json({ insights: cached, provider: 'gemini', using_user_key: !!userGeminiKey });
        return;
      }
    }

    if (!isGeminiConfigured(userGeminiKey)) {
      res.json({ insights: null, needs_api_key: true, provider: 'gemini' });
      return;
    }

    // Last 14 nights before this one, for comparison, and the naps/wake windows leading into this night
    const napExp = napExpectations(adjAge);
    const [recent, dayBlock] = await Promise.all([
      loadScoredNights({ ...rangeBase, days: INSIGHTS_HISTORY_DAYS, beforeDate: currentDate }),
      loadDays(rangeBase, [currentDate], napExp)
        .then(d => dayPromptBlock(d.days[0], napExp, tzOffset))
        .catch(err => { console.log(`[insights] daytime context failed: ${err.message}`); return ''; }),
    ]);
    const recentNights = recent.map(n => ({
      date: n.date,
      score: n.score,
      night: n.night,
      sleepFactors: n.annotation?.sleep_factors,
    }));

    // Fetch events for this night and pick up to 6 with thumbnails spread across the night
    let eventContext: any[] = [];
    try {
      const eventsData = await nanit.getEvents(token, babyUid, 30);
      const rawEvents = (eventsData.events || []) as any[];
      const nightEvents = rawEvents
        .filter(e => e.time >= start && e.time <= end && e.media_urls?.thumbnail)
        .sort((a, b) => a.time - b.time);

      if (nightEvents.length <= 6) {
        eventContext = nightEvents;
      } else {
        const step = nightEvents.length / 6;
        eventContext = Array.from({ length: 6 }, (_, i) => nightEvents[Math.floor(i * step)]);
      }

      eventContext = eventContext.map(e => ({
        uid: e.uid,
        key: e.key,
        title: e.title,
        time: e.time,
        thumbnail_url: e.media_urls?.thumbnail,
      }));
    } catch (err: any) {
      console.log(`[insights] Could not fetch events for video context: ${err.message}`);
    }

    // Only charge the shared server AI budget when using the server's key (BYOK is billed to the user's account)
    if (!userGeminiKey) {
      await consumeAiBudget(babyUid, 'insights');
    }
    const insights = await generateNightInsights(
      { date: currentDate, score: current.score, night: current.night, sleepFactors: current.annotation?.sleep_factors },
      recentNights,
      adjAge,
      prematureWeeks,
      tzOffset,
      eventContext,
      isInProgress,
      profilePromptBlock(profile),
      force,
      dayBlock,
      userGeminiKey,
    );

    if (!insights) {
      res.json({ insights: null, needs_api_key: true, provider: 'gemini' });
      return;
    }

    if (!isInProgress) {
      await store.cacheInsight(babyUid, nightKey, insights).catch(() => {});
    }

    res.json({ insights, in_progress: isInProgress, provider: 'gemini', using_user_key: !!userGeminiKey });
  } catch (err: any) {
    handleRouteError(res, err, 'insights_failed');
  }
});

// Follow-up chat with Gemini grounded in this night's full (corrected) sleep context
router.post('/:babyUid/sleep/insights/chat', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const babyUid = String(req.params.babyUid);
    const body = req.body ?? {};
    const start = parseInt(String(body.start));
    const end = parseInt(String(body.end));
    const birthdate = String(body.birthdate || '');
    const prematureWeeks = parseInt(String(body.premature_weeks)) || 0;
    const bedtimeHour = parseInt(String(body.bedtime_hour)) || 19;
    const wakeHour = parseInt(String(body.wake_hour)) || 8;
    const tzOffset = parseInt(String(body.tz_offset)) || 0;
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    const existingInsights = (body.current_insights ?? null) as NightInsights | null;
    const resolvedModel = resolveGeminiChatModel(typeof body.model === 'string' ? body.model : undefined);

    if (!start || !end || !birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'start, end, and birthdate required' });
      return;
    }

    const messages = rawMessages
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
      .slice(-20)
      .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content.trim().slice(0, 4000) }));

    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      res.status(400).json({ error: 'bad_request', message: 'A user message is required' });
      return;
    }

    // Optional per-request Gemini API key from client header. Never log, cache, or persist it.
    const userGeminiKey = req.header('x-gemini-api-key')?.trim() || undefined;
    if (!isGeminiConfigured(userGeminiKey)) {
      res.json({ reply: null, needs_api_key: true, provider: 'gemini' });
      return;
    }

    const currentDate = localDateStr(start, tzOffset);
    const rangeBase = { token, babyUid, birthdate, prematureWeeks, bedtimeHour, wakeHour, tzOffset };

    const current = await scoreWindow(rangeBase, { date: currentDate, start, end });
    if (!current) {
      res.status(404).json({ error: 'no_data', message: 'No sleep data found for this night.' });
      return;
    }

    const isInProgress = nightIsInProgress(end, current.night.night_end, wakeHour, tzOffset);
    const profile = await getBabyProfile(babyUid);
    const adjAge = getAdjustedAgeMonths(birthdate, prematureWeeks, new Date(current.night.night_start * 1000));
    const napExp = napExpectations(adjAge);

    const [recent, dayBlock] = await Promise.all([
      loadScoredNights({ ...rangeBase, days: INSIGHTS_HISTORY_DAYS, beforeDate: currentDate }),
      loadDays(rangeBase, [currentDate], napExp)
        .then(d => dayPromptBlock(d.days[0], napExp, tzOffset))
        .catch(err => { console.log(`[insights-chat] daytime context failed: ${err.message}`); return ''; }),
    ]);

    if (!userGeminiKey) {
      await consumeAiBudget(babyUid, 'insights_chat');
    }

    const reply = await chatAboutNight({
      currentNight: { date: currentDate, score: current.score, night: current.night, sleepFactors: current.annotation?.sleep_factors },
      recentNights: recent.map(n => ({
        date: n.date,
        score: n.score,
        night: n.night,
        sleepFactors: n.annotation?.sleep_factors,
      })),
      adjustedAgeMonths: adjAge,
      prematureWeeks,
      tzOffset,
      isInProgress,
      profileBlock: profilePromptBlock(profile),
      dayBlock,
      annotationNotes: current.annotation?.notes,
      existingInsights,
      messages,
      model: resolvedModel,
      geminiApiKey: userGeminiKey,
    });

    if (!reply) {
      res.json({ reply: null, needs_api_key: true, provider: 'gemini' });
      return;
    }

    res.json({
      reply,
      provider: 'gemini',
      model: resolvedModel,
      context_days: INSIGHTS_HISTORY_DAYS,
      using_user_key: !!userGeminiKey,
    });
  } catch (err: any) {
    handleRouteError(res, err, 'insights_chat_failed');
  }
});

export default router;

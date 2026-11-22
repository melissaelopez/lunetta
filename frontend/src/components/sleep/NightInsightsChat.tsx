import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageCircle, Send, Trash2 } from 'lucide-react';
import { GeminiKeyInput } from '../common/GeminiKeyInput';
import * as api from '../../services/api';
import { ApiRequestError, type InsightsChatMessage, type NightInsights } from '../../services/api';
import type { Baby } from '../../types';

interface Props {
  baby: Baby | null;
  nightStart: number;
  nightEnd: number;
  prematureWeeks: number;
  bedtimeHour: number;
  wakeHour: number;
  currentInsights?: NightInsights | null;
  compact?: boolean;
}

const SUGGESTIONS = [
  'Why did the score drop?',
  'How does this compare to recent nights?',
  'Any tips for tomorrow’s schedule?',
];

export function NightInsightsChat({
  baby,
  nightStart,
  nightEnd,
  prematureWeeks,
  bedtimeHour,
  wakeHour,
  currentInsights,
  compact = false,
}: Props) {
  const [messages, setMessages] = useState<InsightsChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Reset conversation when switching nights or babies
  useEffect(() => {
    setMessages([]);
    setDraft('');
    setError(null);
    setNeedsKey(false);
  }, [baby?.uid, nightStart]);

  useEffect(() => {
    if (messages.length > 0) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [messages, sending]);

  if (!baby || !nightStart) return null;

  const sendMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || sending) return;

    const nextMessages: InsightsChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setDraft('');
    setError(null);
    setNeedsKey(false);
    setSending(true);

    try {
      const result = await api.chatNightInsights(
        baby.uid,
        nightStart,
        nightEnd,
        baby.birthdate,
        prematureWeeks,
        bedtimeHour,
        wakeHour,
        nextMessages,
        currentInsights,
      );
      if (result.needsApiKey || !result.reply) {
        setNeedsKey(true);
        // Remove the unanswered user turn so they can retry cleanly after entering their key
        setMessages(messages);
        setDraft(text);
        return;
      }
      setMessages([...nextMessages, { role: 'assistant', content: result.reply }]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not reach Gemini';
      setError(msg);
      if (err instanceof ApiRequestError && err.code === 'ai_invalid_key') {
        setNeedsKey(true);
      }
      // Keep the user's question in the draft so they can retry without retyping
      setMessages(messages);
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(draft);
  };

  return (
    <div className={compact ? 'mt-3 border-t border-indigo-200/70 pt-3 dark:border-indigo-500/20' : 'mt-4 border-t border-slate-100 pt-4 dark:border-slate-700'}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
          <MessageCircle size={12} />
          Ask Gemini about this night
        </p>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => { setMessages([]); setError(null); }}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            <Trash2 size={11} />
            Clear
          </button>
        )}
      </div>

      <p className="mb-2.5 text-[11px] text-slate-500 dark:text-slate-400">
        Includes this night&apos;s sleep, naps, recent trends, baby profile, and all of your corrections.
      </p>

      {messages.length === 0 && !sending && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map(prompt => (
            <button
              key={prompt}
              type="button"
              onClick={() => sendMessage(prompt)}
              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-300"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {(messages.length > 0 || sending) && (
        <div className="mb-3 max-h-72 space-y-2.5 overflow-y-auto rounded-xl bg-slate-50 p-3 dark:bg-slate-900/50">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                <Loader2 size={12} className="animate-spin text-indigo-500" />
                Thinking…
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {error && (
        <p className="mb-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}

      {needsKey && (
        <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50">
          <GeminiKeyInput compact onSaved={() => { setNeedsKey(false); setError(null); }} />
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Ask a follow-up question…"
          disabled={sending}
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder:text-slate-500"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          aria-label="Send message to Gemini"
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-40"
        >
          {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          <span className="hidden sm:inline">Ask</span>
        </button>
      </form>
    </div>
  );
}

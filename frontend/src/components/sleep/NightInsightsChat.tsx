import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageCircle, Send, Sparkles, Trash2, Zap } from 'lucide-react';
import { GeminiKeyInput } from '../common/GeminiKeyInput';
import * as api from '../../services/api';
import { ApiRequestError, type GeminiChatModel, type InsightsChatMessage, type NightInsights } from '../../services/api';
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

const MODEL_STORAGE_KEY = 'lunetta_gemini_chat_model';

const CHAT_MODEL_OPTIONS: { id: GeminiChatModel; label: string; title: string }[] = [
  { id: 'gemini-flash-latest', label: 'Flash', title: 'Gemini Flash — fast responses, generous quota' },
  { id: 'gemini-pro-latest', label: 'Pro', title: 'Gemini Pro — deeper reasoning & pattern analysis' },
];

const SUGGESTIONS = [
  'Why did the score drop?',
  'How do arms-in vs. arms-out nights compare?',
  'Any tips for tomorrow’s schedule?',
];

function loadSavedModel(): GeminiChatModel {
  try {
    const saved = localStorage.getItem(MODEL_STORAGE_KEY);
    if (saved === 'gemini-flash-latest' || saved === 'gemini-pro-latest') return saved;
  } catch {
    // ignore storage errors
  }
  return 'gemini-flash-latest';
}

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
  const [model, setModel] = useState<GeminiChatModel>(loadSavedModel);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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

  // Auto-resize textarea up to ~5 lines
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft]);

  if (!baby || !nightStart) return null;

  const selectModel = (next: GeminiChatModel) => {
    setModel(next);
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, next);
    } catch {
      // ignore storage errors
    }
  };

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
        model,
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends on desktop; Shift+Enter inserts a newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(draft);
    }
  };

  return (
    <div className={compact ? 'mt-3 border-t border-indigo-200/70 pt-3 dark:border-indigo-500/20' : 'mt-4 border-t border-slate-100 pt-4 dark:border-indigo-900/50'}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
          <MessageCircle size={12} />
          Ask Gemini about this night
        </p>

        <div className="flex items-center gap-2">
          {/* Selectable Gemini model toggle */}
          <div
            role="group"
            aria-label="Gemini chat model"
            className="inline-flex rounded-lg border border-slate-200 bg-slate-100/90 p-0.5 dark:border-indigo-900/60 dark:bg-[#0e102b]"
          >
            {CHAT_MODEL_OPTIONS.map(opt => {
              const active = model === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  title={opt.title}
                  onClick={() => selectModel(opt.id)}
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium transition ${
                    active
                      ? 'bg-white text-indigo-700 shadow-sm dark:bg-[#1e2352] dark:text-indigo-200'
                      : 'text-slate-500 hover:text-slate-700 dark:text-indigo-300/60 dark:hover:text-indigo-100'
                  }`}
                >
                  {opt.id === 'gemini-pro-latest' ? <Sparkles size={10} /> : <Zap size={10} />}
                  {opt.label}
                </button>
              );
            })}
          </div>

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
      </div>

      <p className="mb-2.5 text-[11px] text-slate-500 dark:text-indigo-200/60">
        Includes this night&apos;s sleep, naps, sleep factors, corrections, baby profile, and up to the <strong>last 14 days</strong> of sleep history (dates older than 2 weeks are not included).
      </p>

      {messages.length === 0 && !sending && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map(prompt => (
            <button
              key={prompt}
              type="button"
              onClick={() => sendMessage(prompt)}
              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-indigo-900/60 dark:bg-[#0e102b]/80 dark:text-indigo-200/80 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-200"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {(messages.length > 0 || sending) && (
        <div className="mb-3 max-h-72 space-y-2.5 overflow-y-auto rounded-xl bg-slate-50 p-3 dark:bg-[#0e102b]/80">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-700 dark:border-indigo-900/60 dark:bg-[#181c42] dark:text-slate-200'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 dark:border-indigo-900/60 dark:bg-[#181c42] dark:text-indigo-200/70">
                <Loader2 size={12} className="animate-spin text-indigo-500" />
                Thinking with Gemini {model === 'gemini-pro-latest' ? 'Pro' : 'Flash'}…
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
        <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-indigo-900/60 dark:bg-[#0e102b]/80">
          <GeminiKeyInput compact onSaved={() => { setNeedsKey(false); setError(null); }} />
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a follow-up question… (Shift+Enter for new line)"
          disabled={sending}
          className="max-h-32 min-h-[36px] flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none disabled:opacity-60 dark:border-indigo-800/70 dark:bg-[#0e102b] dark:text-white dark:placeholder:text-indigo-300/40"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          aria-label="Send message to Gemini"
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-40"
        >
          {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          <span className="hidden sm:inline">Ask</span>
        </button>
      </form>
      <p className="mt-1 hidden text-[10px] text-slate-400 dark:text-indigo-300/45 sm:block">
        Press Enter to send · Shift+Enter for a new line
      </p>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronUp, History, Loader2, MessageCircle, Send, Sparkles, Trash2, Zap } from 'lucide-react';
import { DateTime } from 'luxon';
import { GeminiKeyInput } from '../common/GeminiKeyInput';
import * as api from '../../services/api';
import {
  ApiRequestError,
  type GeminiChatModel,
  type InsightsChatMessage,
  type InsightsChatSummary,
  type NightInsights,
} from '../../services/api';
import type { Baby } from '../../types';

interface Props {
  baby: Baby | null;
  nightDate?: string;
  nightStart: number;
  nightEnd: number;
  prematureWeeks: number;
  bedtimeHour: number;
  wakeHour: number;
  currentInsights?: NightInsights | null;
  compact?: boolean;
  onSelectDate?: (date: string) => void;
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

function formatChatNightDate(iso: string): string {
  const dt = DateTime.fromISO(iso);
  if (!dt.isValid) return iso;
  const sameYear = dt.year === DateTime.now().year;
  return dt.toFormat(sameYear ? 'EEE, MMM d' : 'MMM d, yyyy');
}

export function NightInsightsChat({
  baby,
  nightDate,
  nightStart,
  nightEnd,
  prematureWeeks,
  bedtimeHour,
  wakeHour,
  currentInsights,
  compact = false,
  onSelectDate,
}: Props) {
  const [messages, setMessages] = useState<InsightsChatMessage[]>([]);
  const [resolvedDate, setResolvedDate] = useState<string | null>(nightDate ?? null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [savedChats, setSavedChats] = useState<InsightsChatSummary[]>([]);
  const [showPastChats, setShowPastChats] = useState(false);
  const [expandedPastDate, setExpandedPastDate] = useState<string | null>(null);
  const [pastThreadCache, setPastThreadCache] = useState<Record<string, InsightsChatMessage[]>>({});
  const [loadingPastDate, setLoadingPastDate] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState<GeminiChatModel>(loadSavedModel);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Load persisted chat history for this night + list of past saved chats
  useEffect(() => {
    if (!baby || !nightStart) return;
    let cancelled = false;
    setMessages([]);
    setDraft('');
    setError(null);
    setNeedsKey(false);
    setShowPastChats(false);
    setExpandedPastDate(null);
    setLoadingHistory(true);

    Promise.all([
      api.getInsightsChat(baby.uid, nightDate, nightStart).catch(() => null),
      api.listInsightsChats(baby.uid, 30).catch(() => []),
    ]).then(([thread, list]) => {
      if (cancelled) return;
      if (thread) {
        setMessages(thread.messages);
        setResolvedDate(thread.night_date);
      } else {
        setResolvedDate(nightDate ?? null);
      }
      setSavedChats(list);
    }).finally(() => {
      if (!cancelled) setLoadingHistory(false);
    });

    return () => { cancelled = true; };
  }, [baby, nightDate, nightStart]);

  useEffect(() => {
    if (messages.length > 0 && sending) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [messages.length, sending]);

  // Auto-resize textarea up to ~5 lines
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft]);

  if (!baby || !nightStart) return null;

  const activeDate = nightDate ?? resolvedDate ?? undefined;
  const otherSavedChats = savedChats.filter(c => c.night_date !== activeDate);

  const selectModel = (next: GeminiChatModel) => {
    setModel(next);
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, next);
    } catch {
      // ignore storage errors
    }
  };

  const refreshSavedChats = () => {
    api.listInsightsChats(baby.uid, 30)
      .then(setSavedChats)
      .catch(() => {});
  };

  const handleTogglePastThread = async (dateStr: string) => {
    if (expandedPastDate === dateStr) {
      setExpandedPastDate(null);
      return;
    }
    setExpandedPastDate(dateStr);
    if (pastThreadCache[dateStr]) return;
    setLoadingPastDate(dateStr);
    try {
      const thread = await api.getInsightsChat(baby.uid, dateStr);
      setPastThreadCache(prev => ({ ...prev, [dateStr]: thread.messages }));
    } catch {
      // ignore load failure
    } finally {
      setLoadingPastDate(curr => (curr === dateStr ? null : curr));
    }
  };

  const handleClear = async () => {
    if (clearing) return;
    setClearing(true);
    setError(null);
    try {
      await api.deleteInsightsChat(baby.uid, activeDate, nightStart);
      setMessages([]);
      if (activeDate) {
        setPastThreadCache(prev => {
          const next = { ...prev };
          delete next[activeDate];
          return next;
        });
      }
      refreshSavedChats();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not clear saved chat');
    } finally {
      setClearing(false);
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
        activeDate,
      );
      if (result.needsApiKey || !result.reply) {
        setNeedsKey(true);
        // Remove the unanswered user turn so they can retry cleanly after entering their key
        setMessages(messages);
        setDraft(text);
        return;
      }
      const updated = result.messages && result.messages.length > 0
        ? result.messages
        : [...nextMessages, { role: 'assistant' as const, content: result.reply, model }];
      setMessages(updated);
      if (result.nightDate) setResolvedDate(result.nightDate);
      refreshSavedChats();
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
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

        <div className="flex flex-wrap items-center gap-2">
          {otherSavedChats.length > 0 && (
            <button
              type="button"
              onClick={() => setShowPastChats(v => !v)}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium transition ${
                showPastChats
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-950/60 dark:text-indigo-200'
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-indigo-200 hover:text-indigo-600 dark:border-indigo-900/60 dark:bg-[#0e102b] dark:text-indigo-200/75 dark:hover:border-indigo-500/40'
              }`}
            >
              <History size={10} />
              Past chats ({otherSavedChats.length})
              {showPastChats ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </button>
          )}

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
              onClick={handleClear}
              disabled={clearing}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 disabled:opacity-50 dark:hover:text-slate-300"
            >
              <Trash2 size={11} />
              {clearing ? 'Clearing…' : 'Clear'}
            </button>
          )}
        </div>
      </div>

      <p className="mb-2.5 text-[11px] text-slate-500 dark:text-indigo-200/60">
        Includes this night&apos;s sleep, naps, sleep factors, corrections, baby profile, and up to the <strong>last 14 days</strong> of sleep history (dates older than 2 weeks are not included). Chats are saved automatically.
      </p>

      {/* Collapsible list of saved chats from other nights */}
      {showPastChats && otherSavedChats.length > 0 && (
        <div className="mb-3 space-y-1.5 rounded-xl border border-slate-200/90 bg-slate-50/90 p-2.5 dark:border-indigo-900/60 dark:bg-[#0e102b]/90">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-indigo-300/60">
            Saved chats from other nights
          </p>
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {otherSavedChats.map(item => {
              const isExpanded = expandedPastDate === item.night_date;
              const threadMsgs = pastThreadCache[item.night_date];
              const isLoading = loadingPastDate === item.night_date;

              return (
                <div
                  key={item.night_date}
                  className="rounded-lg border border-slate-200/80 bg-white dark:border-indigo-900/50 dark:bg-[#15183a]"
                >
                  <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                    <button
                      type="button"
                      onClick={() => handleTogglePastThread(item.night_date)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-slate-700 dark:text-indigo-100">
                          {formatChatNightDate(item.night_date)}
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-indigo-300/50">
                          {item.message_count} msg{item.message_count === 1 ? '' : 's'}
                        </span>
                      </div>
                      {item.preview && (
                        <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-indigo-200/60">
                          {item.preview}
                        </p>
                      )}
                    </button>
                    {onSelectDate && (
                      <button
                        type="button"
                        onClick={() => onSelectDate(item.night_date)}
                        title={`Switch to night of ${formatChatNightDate(item.night_date)}`}
                        className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-[10px] font-medium text-indigo-600 transition hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
                      >
                        Open
                        <ArrowUpRight size={10} />
                      </button>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-100 px-2.5 py-2 dark:border-indigo-900/50">
                      {isLoading ? (
                        <div className="flex items-center gap-1.5 py-1 text-[11px] text-slate-400">
                          <Loader2 size={11} className="animate-spin" />
                          Loading chat…
                        </div>
                      ) : threadMsgs && threadMsgs.length > 0 ? (
                        <div className="max-h-48 space-y-2 overflow-y-auto">
                          {threadMsgs.map((m, idx) => (
                            <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                              <div
                                className={`max-w-[88%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed ${
                                  m.role === 'user'
                                    ? 'bg-indigo-600/90 text-white'
                                    : 'border border-slate-200 bg-slate-50 text-slate-700 dark:border-indigo-900/60 dark:bg-[#0e102b] dark:text-slate-200'
                                }`}
                              >
                                {m.content}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-400">No messages found.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loadingHistory && messages.length === 0 && (
        <div className="mb-2.5 flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-indigo-300/50">
          <Loader2 size={11} className="animate-spin" />
          Loading saved chat…
        </div>
      )}

      {!loadingHistory && messages.length === 0 && !sending && (
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

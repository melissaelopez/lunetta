import { useState, useEffect } from 'react';
import { Eye, EyeOff, KeyRound, Lock, Trash2, Check, ExternalLink } from 'lucide-react';
import {
  clearGeminiKey,
  getGeminiKey,
  getGeminiKeyMode,
  setGeminiKey,
  subscribeGeminiKey,
  type GeminiKeyStorageMode,
} from '../../utils/geminiKey';

interface Props {
  compact?: boolean;
  onSaved?: () => void;
}

export function GeminiKeyInput({ compact = false, onSaved }: Props) {
  const [hasKey, setHasKey] = useState<boolean>(() => !!getGeminiKey());
  const [mode, setMode] = useState<GeminiKeyStorageMode>(() => getGeminiKeyMode());
  const [draft, setDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [remember, setRemember] = useState<boolean>(() => getGeminiKeyMode() === 'device');
  const [savedFeedback, setSavedFeedback] = useState(false);

  useEffect(() => {
    const sync = () => {
      const currentKey = getGeminiKey();
      const currentMode = getGeminiKeyMode();
      setHasKey(!!currentKey);
      setMode(currentMode);
      if (currentMode === 'device') setRemember(true);
    };
    return subscribeGeminiKey(sync);
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    setGeminiKey(trimmed, remember);
    setDraft('');
    setShowKey(false);
    setSavedFeedback(true);
    window.setTimeout(() => setSavedFeedback(false), 2000);
    onSaved?.();
  };

  const handleClear = () => {
    clearGeminiKey();
    setDraft('');
    setShowKey(false);
  };

  return (
    <div className={compact ? 'space-y-2.5' : 'space-y-3'}>
      {hasKey && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
          <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
            <KeyRound size={13} className="shrink-0" />
            <span>
              Using your Gemini key ({mode === 'device' ? 'saved on this device' : 'this session only'})
            </span>
          </div>
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
            title="Remove saved Gemini API key"
          >
            <Trash2 size={12} />
            Remove
          </button>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-2.5">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder={hasKey ? 'Enter a new Gemini API key to replace…' : 'Paste your Gemini API key (AIza…)'}
              autoComplete="off"
              spellCheck={false}
              aria-label="Gemini API key"
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-9 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder:text-slate-500"
            />
            <button
              type="button"
              onClick={() => setShowKey(v => !v)}
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <button
            type="submit"
            disabled={!draft.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-40"
          >
            {savedFeedback ? <Check size={13} /> : null}
            {savedFeedback ? 'Saved' : hasKey ? 'Update' : 'Save key'}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={remember}
              onChange={e => setRemember(e.target.checked)}
              className="accent-indigo-500"
            />
            <span>Remember on this device</span>
          </label>
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
          >
            Get a Gemini key
            <ExternalLink size={11} />
          </a>
        </div>
      </form>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        <Lock size={12} className="mt-0.5 shrink-0 text-slate-400" />
        <span>
          Stored only in your browser ({remember ? 'local storage' : 'session only, cleared on tab close'}) and sent via the{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px] dark:bg-slate-700">X-Gemini-Api-Key</code> header.
          Lunetta never stores, caches, or logs your key on the server.
        </span>
      </p>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Loader2, Plus, Save, SlidersHorizontal, StickyNote, X } from 'lucide-react';
import { DateTime } from 'luxon';
import { Card } from '../common/Card';
import { errorMessage } from '../../utils/errors';
import * as api from '../../services/api';
import type { Baby, ScoredNight } from '../../types';

const SWADDLE_PRESETS = [
  'Arms in — swaddle',
  'One arm out — swaddle',
  'Arms out — Halo Swaddle Sleep Sack',
  'Arms out — Halo Easy Transition Sleep Sack',
  'Regular sleep sack',
  'Pajamas only',
];

const OTHER_PRESETS = [
  'Pacifier',
  'White noise',
  'Dream feed',
  'Reflux / extra upright time',
  'Late nap / overtired',
  'Travel / different room',
  'Sick / teething / fussy',
];

const ALL_BUILTIN = new Set([...SWADDLE_PRESETS, ...OTHER_PRESETS]);

interface Props {
  baby: Baby | null;
  nightDate: string;
  night: ScoredNight | null;
  customOptions: string[];
  onUpdateCustomOptions: (options: string[]) => void;
  onSaved: () => void;
  loading?: boolean;
}

export function SleepFactorsCard({
  baby,
  nightDate,
  night,
  customOptions,
  onUpdateCustomOptions,
  onSaved,
  loading,
}: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [inheritedFrom, setInheritedFrom] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [newOption, setNewOption] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasExplicitFactors = Array.isArray(night?.annotation?.sleep_factors);
  const serverFactors = hasExplicitFactors
    ? (night!.annotation!.sleep_factors ?? [])
    : (night?.inherited_sleep_factors ?? []);
  const serverInheritedFrom = !hasExplicitFactors && night?.inherited_sleep_factors?.length
    ? (night.inherited_sleep_factors_from ?? null)
    : null;
  const serverNotes = night?.annotation?.notes ?? '';
  const serverKey = `${night?.night_id ?? nightDate}:${hasExplicitFactors ? '1' : '0'}:${serverFactors.join('|')}:${serverInheritedFrom ?? ''}:${serverNotes}`;

  useEffect(() => {
    if (night) {
      setSelected(serverFactors);
      setInheritedFrom(serverInheritedFrom);
      setSavedNote(serverNotes);
      setNoteDraft(serverNotes);
      setError(null);
      return;
    }
    if (loading || !baby) return;
    let cancelled = false;
    api.getSleepFactors(baby.uid, nightDate)
      .then(data => {
        if (cancelled) return;
        setSelected(data.sleep_factors);
        setInheritedFrom(data.inherited ? data.inherited_from : null);
        setSavedNote(data.notes);
        setNoteDraft(data.notes);
        setError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setSelected([]);
        setInheritedFrom(null);
        setSavedNote('');
        setNoteDraft('');
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey, night, loading, baby, nightDate]);

  const nightId = night?.night_id ?? (baby ? `${baby.uid}:${nightDate}` : '');
  const noteDirty = noteDraft.trim() !== savedNote.trim();

  const persistFactors = async (next: string[]) => {
    if (!baby || !nightId) return;
    const prev = selected;
    const prevInherited = inheritedFrom;
    setSelected(next);
    setInheritedFrom(null);
    setSaving(true);
    setError(null);
    try {
      await api.setSleepFactors(baby.uid, nightId, next);
      onSaved();
    } catch (err) {
      setSelected(prev);
      setInheritedFrom(prevInherited);
      setError(errorMessage(err, 'Could not save sleep factors'));
    } finally {
      setSaving(false);
    }
  };

  const persistNote = async (value: string): Promise<boolean> => {
    if (!baby || !nightId) return false;
    const cleaned = value.trim().slice(0, 1000);
    setSavingNote(true);
    setError(null);
    try {
      await api.setNightNotes(baby.uid, nightId, cleaned);
      setSavedNote(cleaned);
      setNoteDraft(cleaned);
      onSaved();
      return true;
    } catch (err) {
      setError(errorMessage(err, 'Could not save note'));
      return false;
    } finally {
      setSavingNote(false);
    }
  };

  const toggleFactor = (factor: string) => {
    if (saving) return;
    const exists = selected.includes(factor);
    const next = exists ? selected.filter(f => f !== factor) : [...selected, factor];
    persistFactors(next);
  };

  const addCustomOption = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newOption.trim().slice(0, 80);
    if (!cleaned || saving) return;

    // Save to reusable options list (synced across devices) if not already built-in or listed
    if (!ALL_BUILTIN.has(cleaned) && !customOptions.includes(cleaned)) {
      onUpdateCustomOptions([...customOptions, cleaned]);
    }
    setNewOption('');

    // Also immediately select it for this night
    if (!selected.includes(cleaned)) {
      persistFactors([...selected, cleaned]);
    }
  };

  const removeCustomOption = (option: string) => {
    onUpdateCustomOptions(customOptions.filter(o => o !== option));
  };

  const handleToggleExpand = async () => {
    if (expanded && noteDirty && !savingNote) {
      // Auto-save any unsaved note edits before collapsing so nothing is lost
      await persistNote(noteDraft);
    }
    setExpanded(v => !v);
  };

  const hasContent = selected.length > 0 || savedNote.length > 0;

  const action = (
    <button
      type="button"
      onClick={handleToggleExpand}
      disabled={savingNote}
      className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500 disabled:opacity-60 dark:text-indigo-400 dark:hover:text-indigo-300"
    >
      {(saving || savingNote) && <Loader2 size={12} className="animate-spin" />}
      {expanded ? (
        <>Done <ChevronUp size={13} /></>
      ) : (
        <>{hasContent ? 'Edit' : 'Add'} <ChevronDown size={13} /></>
      )}
    </button>
  );

  if (loading && !night) {
    return (
      <Card title="Sleep Factors" action={<SlidersHorizontal size={14} className="text-indigo-400" />}>
        <div className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-indigo-950/60" />
      </Card>
    );
  }

  return (
    <Card title="Sleep Factors" action={action}>
      {/* Active factors summary chips (always 1-tap removable) */}
      {selected.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-1.5">
            {selected.map(factor => (
              <span
                key={factor}
                className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-200"
              >
                <span>{factor}</span>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => toggleFactor(factor)}
                  aria-label={`Remove ${factor}`}
                  className="rounded-full p-0.5 text-indigo-400 transition hover:bg-indigo-200/60 hover:text-indigo-700 dark:hover:bg-indigo-500/30 dark:hover:text-white"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
          {inheritedFrom && (
            <p className="mt-1.5 text-[10px] text-slate-400 dark:text-indigo-200/50">
              Defaulted from {DateTime.fromISO(inheritedFrom).toFormat('MMM d')} · tap to tweak
            </p>
          )}
        </div>
      )}

      {/* Saved qualitative note preview when collapsed */}
      {savedNote && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={`${selected.length > 0 ? 'mt-2.5' : ''} flex w-full items-start gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 px-2.5 py-2 text-left text-xs leading-relaxed text-slate-600 transition hover:border-indigo-300 dark:border-indigo-900/60 dark:bg-[#0e102b]/80 dark:text-indigo-100/80 dark:hover:border-indigo-500/50`}
        >
          <StickyNote size={13} className="mt-0.5 shrink-0 text-indigo-500 dark:text-indigo-400" />
          <span className="whitespace-pre-wrap">{savedNote}</span>
        </button>
      )}

      {!hasContent && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-2.5 text-xs text-slate-500 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-indigo-800/70 dark:text-indigo-300/70 dark:hover:border-indigo-500 dark:hover:text-indigo-200"
        >
          <Plus size={13} />
          Tag swaddle, factors, or add a note for this night
        </button>
      )}

      {/* Expandable checklist + reusable custom option creator + qualitative note */}
      {expanded && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3 dark:border-indigo-900/50">
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-indigo-300/60">
              Swaddle &amp; Sleepwear
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SWADDLE_PRESETS.map(option => {
                const active = selected.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={saving}
                    onClick={() => toggleFactor(option)}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition disabled:opacity-50 ${
                      active
                        ? 'border-indigo-500 bg-indigo-600 text-white dark:border-indigo-400 dark:bg-indigo-500'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:bg-indigo-50/60 dark:border-indigo-900/60 dark:bg-[#181c42] dark:text-indigo-100/80 dark:hover:border-indigo-500/60'
                    }`}
                  >
                    {active && <Check size={11} />}
                    <span>{option}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-indigo-300/60">
              Other Factors
            </p>
            <div className="flex flex-wrap gap-1.5">
              {OTHER_PRESETS.map(option => {
                const active = selected.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={saving}
                    onClick={() => toggleFactor(option)}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition disabled:opacity-50 ${
                      active
                        ? 'border-indigo-500 bg-indigo-600 text-white dark:border-indigo-400 dark:bg-indigo-500'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:bg-indigo-50/60 dark:border-indigo-900/60 dark:bg-[#181c42] dark:text-indigo-100/80 dark:hover:border-indigo-500/60'
                    }`}
                  >
                    {active && <Check size={11} />}
                    <span>{option}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {customOptions.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-indigo-300/60">
                Your Custom Options
              </p>
              <div className="flex flex-wrap gap-1.5">
                {customOptions.map(option => {
                  const active = selected.includes(option);
                  return (
                    <div
                      key={option}
                      className={`inline-flex items-center rounded-lg border text-[11px] font-medium transition ${
                        active
                          ? 'border-indigo-500 bg-indigo-600 text-white dark:border-indigo-400 dark:bg-indigo-500'
                          : 'border-slate-200 bg-white text-slate-600 dark:border-indigo-900/60 dark:bg-[#181c42] dark:text-indigo-100/80'
                      }`}
                    >
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => toggleFactor(option)}
                        className="inline-flex items-center gap-1 py-1 pl-2 pr-1.5 disabled:opacity-50"
                      >
                        {active && <Check size={11} />}
                        <span>{option}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeCustomOption(option)}
                        aria-label={`Delete custom option ${option}`}
                        title="Remove from your saved options list"
                        className={`border-l px-1.5 py-1 transition ${
                          active
                            ? 'border-indigo-400/50 text-indigo-100 hover:text-white'
                            : 'border-slate-200 text-slate-400 hover:text-rose-500 dark:border-indigo-900/60 dark:hover:text-rose-400'
                        }`}
                      >
                        <X size={10} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add a new reusable option (saved for future nights + selected for tonight) */}
          <form onSubmit={addCustomOption} className="flex gap-1.5 pt-0.5">
            <input
              type="text"
              value={newOption}
              onChange={e => setNewOption(e.target.value.slice(0, 80))}
              placeholder="New option (e.g. Zipadee-Zip, Kyte 1.0)…"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-indigo-800/70 dark:bg-[#0e102b] dark:text-white dark:placeholder:text-indigo-300/40"
            />
            <button
              type="submit"
              disabled={!newOption.trim() || saving}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-40"
            >
              <Plus size={12} />
              Add
            </button>
          </form>

          {/* Qualitative note for this night */}
          <div className="border-t border-slate-100 pt-2.5 dark:border-indigo-900/50">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label
                htmlFor={`night-note-${nightDate}`}
                className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-indigo-300/60"
              >
                <StickyNote size={11} />
                Night Note
              </label>
              {savedNote && (
                <button
                  type="button"
                  disabled={savingNote}
                  onClick={() => persistNote('')}
                  className="text-[10px] text-slate-400 transition hover:text-rose-500 disabled:opacity-40 dark:text-indigo-300/50 dark:hover:text-rose-400"
                >
                  Clear note
                </button>
              )}
            </div>
            <textarea
              id={`night-note-${nightDate}`}
              rows={2}
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value.slice(0, 1000))}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && noteDirty && !savingNote) {
                  e.preventDefault();
                  persistNote(noteDraft);
                }
              }}
              placeholder="e.g. Attempted a dream feed but it didn't go very smoothly…"
              className="w-full resize-y rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-indigo-800/70 dark:bg-[#0e102b] dark:text-white dark:placeholder:text-indigo-300/40"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] text-slate-400 dark:text-indigo-300/45">
                {noteDirty ? 'Unsaved changes' : savedNote ? 'Saved' : 'Optional context for this night'}
              </span>
              <button
                type="button"
                disabled={!noteDirty || savingNote}
                onClick={() => persistNote(noteDraft)}
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-indigo-500 disabled:opacity-40"
              >
                {savingNote ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                Save note
              </button>
            </div>
          </div>

          <p className="text-[10px] text-slate-400 dark:text-indigo-200/50">
            Saved per night &amp; shared across devices — Gemini uses your factors and notes to compare sleep patterns.
          </p>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </Card>
  );
}

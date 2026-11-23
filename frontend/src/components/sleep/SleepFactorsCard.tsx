import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Loader2, Plus, SlidersHorizontal, X } from 'lucide-react';
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
  const [expanded, setExpanded] = useState(false);
  const [newOption, setNewOption] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const serverFactors = night?.annotation?.sleep_factors ?? [];
  const serverKey = `${night?.night_id ?? nightDate}:${serverFactors.join('|')}`;

  useEffect(() => {
    setSelected(serverFactors);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  const nightId = night?.night_id ?? (baby ? `${baby.uid}:${nightDate}` : '');

  const persistFactors = async (next: string[]) => {
    if (!baby || !nightId) return;
    const prev = selected;
    setSelected(next);
    setSaving(true);
    setError(null);
    try {
      await api.setSleepFactors(baby.uid, nightId, next);
      onSaved();
    } catch (err) {
      setSelected(prev);
      setError(errorMessage(err, 'Could not save sleep factors'));
    } finally {
      setSaving(false);
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

  const action = (
    <button
      type="button"
      onClick={() => setExpanded(v => !v)}
      className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
    >
      {saving && <Loader2 size={12} className="animate-spin" />}
      {expanded ? (
        <>Done <ChevronUp size={13} /></>
      ) : (
        <>{selected.length > 0 ? 'Edit' : 'Add'} <ChevronDown size={13} /></>
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
      {selected.length > 0 ? (
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
      ) : !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-2.5 text-xs text-slate-500 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-indigo-800/70 dark:text-indigo-300/70 dark:hover:border-indigo-500 dark:hover:text-indigo-200"
        >
          <Plus size={13} />
          Tag swaddle, sleep sack, or factors for this night
        </button>
      ) : null}

      {/* Expandable checklist + reusable custom option creator */}
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

          <p className="text-[10px] text-slate-400 dark:text-indigo-200/50">
            Saved per night &amp; shared across devices — Gemini uses these to compare sleep patterns.
          </p>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </Card>
  );
}

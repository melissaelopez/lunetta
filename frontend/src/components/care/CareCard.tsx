import { useState } from 'react';
import { Baby, ChevronDown, ChevronUp, Droplets, Info } from 'lucide-react';
import { Card } from '../common/Card';
import { StatValue } from '../common/StatValue';
import type { CalendarEvent } from '../../types';

interface Props {
  events: CalendarEvent[];
  allTypes: string[];
  loading?: boolean;
}

export function CareCard({ events, allTypes, loading }: Props) {
  const [isOpen, setIsOpen] = useState(true);

  const feeds = events.filter(e => e.type === 'bottle_feed');
  const diapers = events.filter(e => e.type === 'diaper_change');
  const totalMl = feeds.reduce((sum, f) => sum + (f.feed_amount || 0), 0);
  const totalOz = Math.round(totalMl * 0.033814 * 10) / 10;

  if (!isOpen) {
    const hasCare = !loading && (feeds.length > 0 || diapers.length > 0);
    return (
      <div className="col-span-full rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-expanded={false}
          className="flex w-full items-center justify-between rounded-2xl px-5 py-3.5 text-left transition hover:bg-slate-50/70 dark:hover:bg-slate-700/30"
        >
          <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <Baby size={15} className="text-pink-500 dark:text-pink-400" />
            Care (24h)
            {hasCare && (
              <span className="text-xs font-normal normal-case tracking-normal text-slate-400 dark:text-slate-500">
                · {feeds.length} feed{feeds.length === 1 ? '' : 's'} · {diapers.length} diaper{diapers.length === 1 ? '' : 's'}
              </span>
            )}
          </span>
          <span className="flex items-center gap-1 text-xs font-medium text-slate-400 dark:text-slate-500">
            Show
            <ChevronDown size={15} />
          </span>
        </button>
      </div>
    );
  }

  const collapseAction = (
    <button
      type="button"
      onClick={() => setIsOpen(false)}
      aria-expanded={true}
      className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
    >
      Hide
      <ChevronUp size={15} />
      <Baby size={15} className="text-pink-500 dark:text-pink-400" />
    </button>
  );

  if (loading) {
    return (
      <Card title="Care (24h)" className="col-span-full" action={collapseAction}>
        <div className="flex h-24 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      </Card>
    );
  }

  if (feeds.length === 0 && diapers.length === 0) {
    return (
      <Card title="Care (24h)" className="col-span-full" action={collapseAction}>
        <div className="space-y-2">
          <p className="text-sm text-slate-400">No feed or diaper data logged for this date.</p>
          {allTypes.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-900">
              <Info size={14} className="mt-0.5 shrink-0 text-slate-400" />
              <p className="text-xs text-slate-500">
                Calendar types found: {allTypes.join(', ')}
              </p>
            </div>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card title="Care (24h)" className="col-span-full" action={collapseAction}>
      <div className="grid grid-cols-2 gap-4">
        <StatValue
          icon={<Baby size={16} />}
          label="Feeds"
          value={feeds.length}
          sub={totalMl > 0 ? `${totalMl}ml / ${totalOz}oz` : undefined}
        />
        <StatValue
          icon={<Droplets size={16} />}
          label="Diapers"
          value={diapers.length}
          sub={`${diapers.filter(d => d.change_type === 'poo' || d.change_type === 'mixed').length} poo`}
        />
      </div>
    </Card>
  );
}

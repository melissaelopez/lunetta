import { useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface CarouselTab {
  id: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
}

interface Props {
  tabs: CarouselTab[];
  activeId: string;
  onChange: (id: string) => void;
}

export function SectionCarouselTabs({ tabs, activeId, onChange }: Props) {
  const touchStart = useRef<{ x: number; y: number; ignore: boolean } | null>(null);
  const activeIndex = Math.max(0, tabs.findIndex(t => t.id === activeId));
  const activeTab = tabs[activeIndex] ?? tabs[0];

  const step = (delta: number) => {
    if (tabs.length <= 1) return;
    const nextIndex = (activeIndex + delta + tabs.length) % tabs.length;
    onChange(tabs[nextIndex].id);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement | null;
    // Don't hijack swipes inside charts, range sliders, video players, or horizontally scrollable rows
    const ignore = !!target?.closest('.recharts-wrapper, input, video, [data-no-tab-swipe]');
    const touch = e.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY, ignore };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current || touchStart.current.ignore) {
      touchStart.current = null;
      return;
    }
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStart.current.x;
    const dy = touch.clientY - touchStart.current.y;
    touchStart.current = null;

    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      step(dx < 0 ? 1 : -1);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      step(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      step(-1);
    }
  };

  if (!activeTab) return null;

  return (
    <div className="col-span-full space-y-4">
      {/* Carousel Tab Bar */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="Previous section"
          className="shrink-0 rounded-xl border border-slate-200 bg-white p-2 text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-700 dark:border-indigo-900/50 dark:bg-[#131636] dark:text-indigo-200/70 dark:hover:bg-[#1b204d] dark:hover:text-white"
        >
          <ChevronLeft size={16} />
        </button>

        <div
          role="tablist"
          aria-label="Dashboard sections"
          onKeyDown={handleKeyDown}
          className="grid flex-1 gap-1 rounded-xl border border-slate-200 bg-slate-100/90 p-1 dark:border-indigo-900/50 dark:bg-[#0e102b]"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
          {tabs.map(tab => {
            const isActive = tab.id === activeTab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`panel-${tab.id}`}
                onClick={() => onChange(tab.id)}
                className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition ${
                  isActive
                    ? 'bg-white text-indigo-700 shadow-sm dark:bg-[#1e2352] dark:text-white'
                    : 'text-slate-500 hover:text-slate-700 dark:text-indigo-200/60 dark:hover:text-indigo-100'
                }`}
              >
                <span className="shrink-0">{tab.icon}</span>
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => step(1)}
          aria-label="Next section"
          className="shrink-0 rounded-xl border border-slate-200 bg-white p-2 text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-700 dark:border-indigo-900/50 dark:bg-[#131636] dark:text-indigo-200/70 dark:hover:bg-[#1b204d] dark:hover:text-white"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Active Tab Panel (swipeable on mobile) */}
      <div
        role="tabpanel"
        id={`panel-${activeTab.id}`}
        aria-labelledby={`tab-${activeTab.id}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="space-y-4"
      >
        {activeTab.content}
      </div>
    </div>
  );
}
